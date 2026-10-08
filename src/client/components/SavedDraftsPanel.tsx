import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog.js";
import { api } from "../lib/api.js";
import type { ComposeDraft, ComposeDraftSummary } from "../lib/models.js";

export function SavedDraftsPanel(props: { revision: number; onOpen: (draft: ComposeDraft) => void }) {
  const [deleting, setDeleting] = useState<ComposeDraftSummary | null>(null);
  const deletingRequest = useRef(false);
  const [drafts, setDrafts] = useState<ComposeDraftSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const nextOffset = useRef(0);
  async function load(offset = 0): Promise<void> {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++sequence.current; setBusy(true);
    try {
      const response = await api.drafts(offset, controller.signal);
      if (current !== sequence.current) return;
      setDrafts((previous) => offset ? [...previous, ...response.drafts.filter((draft) => !previous.some((item) => item.id === draft.id))] : response.drafts);
      nextOffset.current = offset + response.drafts.length;
      setHasMore(response.hasMore); setError("");
    } catch (failure) { if (current === sequence.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Saved drafts could not be loaded. Try Refresh drafts."); }
    finally { if (current === sequence.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; request.current?.abort(); }; }, [props.revision]);
  async function open(id: string): Promise<void> {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++sequence.current; setBusy(true);
    try {
      const response = await api.draft(id, controller.signal);
      if (current === sequence.current) { setError(""); props.onOpen(response.draft); }
    } catch (failure) { if (current === sequence.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The saved draft could not be opened."); }
    finally { if (current === sequence.current) setBusy(false); }
  }
  async function remove(): Promise<void> {
    if (!deleting || deletingRequest.current) return;
    deletingRequest.current = true; setBusy(true);
    try { await api.deleteDraft(deleting.id); setDeleting(null); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Draft deletion failed."); }
    finally { deletingRequest.current = false; setBusy(false); }
  }
  return <section className="content-card saved-drafts" aria-labelledby="saved-drafts-heading">
    <div className="content-card-header"><h2 id="saved-drafts-heading">Saved drafts</h2><button className="button button-outlined" type="button" disabled={busy} onClick={() => void load()}>Refresh drafts</button></div>
    <p className="muted">Drafts store redacted settings. Storage is limited to 1,000 drafts and 25 MiB; drafts are never automatically deleted. Credentials and pasted Compose must be entered again. Opening a draft does not change Docker or your current connection.</p>
    {error && <p role="alert" className="warning-text">{error} Displayed entries may be outdated.</p>}
    {busy && <p role="status">Loading saved draft data…</p>}
    {drafts.length ? <ul className="draft-list">{drafts.map((draft) => <li className="draft-row" key={draft.id}><div><strong>{draft.title}</strong><span className="muted">{draft.taskType.replaceAll("_", " ")} · {Number.isNaN(Date.parse(draft.updatedAt)) ? "Date unavailable" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.updatedAt))}</span></div><button type="button" className="button button-outlined" disabled={busy} onClick={() => void open(draft.id)} aria-label={`Open draft: ${draft.title}`}>Open</button><button type="button" className="button button-outlined" disabled={busy} onClick={() => { setError(""); setDeleting(draft); }} aria-label={`Delete draft: ${draft.title}`}>Delete</button></li>)}</ul> : !busy && !error && <p className="muted">No saved drafts yet. Select “Save a redacted draft” before generating guidance.</p>}
    {hasMore && <button className="button button-text" type="button" disabled={busy} onClick={() => void load(nextOffset.current)}>Load more drafts</button>}
    <Dialog open={Boolean(deleting)} title="Delete saved draft?" danger confirmLabel="Delete draft" onClose={() => { if (!deletingRequest.current) setDeleting(null); }} onConfirm={() => void remove()}>
      <p>Delete “{deleting?.title}”? This removes its saved settings permanently. Your current form and Docker containers are unaffected.</p>
      {error && <p role="alert">{error}</p>}
      {deletingRequest.current && <p role="status">Deleting draft…</p>}
    </Dialog>
  </section>;
}

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";

export function SetupView(props: { missingConfiguration?: string[]; onComplete: (session: { user: any; csrfToken: string }) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ setupSecret: "", displayName: "", username: "", email: "", password: "", passwordConfirm: "" });
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api.register(form);
      props.onComplete(response);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (props.missingConfiguration?.length) {
    return (
      <main className="auth-page">
        <section className="auth-window">
          <div className="auth-logo"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div>
          <div className="auth-heading"><span className="status-icon warning"><Icon name="warning" /></span><h1>{t("setupUnavailable")}</h1><p>{t("setupUnavailableText")}</p></div>
          <div className="technical-card"><code>{props.missingConfiguration.join("\n")}</code></div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="auth-window" onSubmit={(event) => void submit(event)}>
        <div className="auth-logo"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div>
        <div className="auth-heading"><h1>{t("setupTitle")}</h1><p>{t("setupSubtitle")}</p></div>
        {error && <div className="inline-banner warning" role="alert"><Icon name="warning" /><span>{error}</span></div>}
        <label className="text-field"><span>{t("setupSecret")}</span><input autoFocus required type="password" autoComplete="one-time-code" value={form.setupSecret} onChange={(event) => update("setupSecret", event.target.value)} /><small>{t("setupSecretHint")}</small></label>
        <div className="field-grid">
          <label className="text-field"><span>{t("displayName")}</span><input required autoComplete="name" value={form.displayName} onChange={(event) => update("displayName", event.target.value)} /></label>
          <label className="text-field"><span>{t("adminUsername")}</span><input required autoComplete="username" value={form.username} onChange={(event) => update("username", event.target.value)} /></label>
        </div>
        <label className="text-field"><span>{t("emailOptional")}</span><input type="email" autoComplete="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
        <div className="field-grid">
          <label className="text-field"><span>{t("adminPassword")}</span><input required minLength={12} type="password" autoComplete="new-password" value={form.password} onChange={(event) => update("password", event.target.value)} /></label>
          <label className="text-field"><span>{t("passwordConfirm")}</span><input required minLength={12} type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={(event) => update("passwordConfirm", event.target.value)} /></label>
        </div>
        <button className="button button-filled auth-submit" type="submit" disabled={busy}>{busy ? t("loading") : t("createAdmin")}</button>
        <p className="auth-note">{t("setupFootnote")}</p>
      </form>
    </main>
  );
}

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";

export function LoginView({ onComplete }: { onComplete: (session: { user: any; csrfToken: string }) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onComplete(await api.login(form));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <form className="auth-window login-window" onSubmit={(event) => void submit(event)}>
        <div className="auth-logo"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div>
        <div className="auth-heading"><h1>{t("welcomeBack")}</h1><p>{t("loginSubtitle")}</p></div>
        {error && <div className="inline-banner warning" role="alert"><Icon name="warning" /><span>{error}</span></div>}
        <label className="text-field"><span>{t("username")}</span><input autoFocus required autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label className="text-field"><span>{t("password")}</span><input required type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <button className="button button-filled auth-submit" type="submit" disabled={busy}>{busy ? t("loading") : t("signIn")}</button>
      </form>
    </main>
  );
}

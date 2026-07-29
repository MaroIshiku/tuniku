import type { ReactNode } from "react";
import type { Section, User } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "./Icon.js";

const nav: Array<{ id: Section; icon: string; label: "overview" | "vpn" | "ports" | "assistant" }> = [
  { id: "overview", icon: "overview", label: "overview" },
  { id: "control", icon: "vpn", label: "vpn" },
  { id: "ports", icon: "ports", label: "ports" },
  { id: "assistant", icon: "code", label: "assistant" }
];

export function AppShell(props: {
  section: Section;
  user: User;
  children: ReactNode;
  onSection: (section: Section) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const initials = props.user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="psu-app-shell app-layout">
      <header className="app-header">
        <div className="header-inner">
          <div className="psu-app-symbol app-logo">
            <img src="/assets/logos/tuniku.png" alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling?.removeAttribute("hidden"); }} />
            <span hidden><Icon name="vpn" /></span>
          </div>
          <div className="app-identity">
            <strong>Tuniku</strong>
            <span>{t("appSubtitle")}</span>
          </div>
          <div className="header-spacer" />
          <button className="avatar-button" type="button" aria-label={`${t("settings")}: ${props.user.displayName}`} onClick={props.onSettings}>
            {initials || <Icon name="user" />}
          </button>
          <button className="icon-button" type="button" aria-label={t("settings")} onClick={props.onSettings}><Icon name="menu" /></button>
        </div>
      </header>
      <aside className="navigation-rail" aria-label="Primary">
        <div className="rail-logo psu-app-symbol"><img src="/assets/logos/tuniku.png" alt="" /></div>
        <nav>
          {nav.map((item) => (
            <button className={`rail-item ${props.section === item.id ? "active" : ""}`} type="button" key={item.id} onClick={() => props.onSection(item.id)} aria-current={props.section === item.id ? "page" : undefined}>
              <span><Icon name={item.icon} /></span>
              {t(item.label)}
            </button>
          ))}
        </nav>
        <button className="rail-item rail-settings" type="button" onClick={props.onSettings}>
          <span><Icon name="settings" /></span>
          {t("settings")}
        </button>
      </aside>
      <main className="psu-main app-main">{props.children}</main>
      <nav className="bottom-nav" aria-label="Primary">
        {nav.map((item) => (
          <button className={props.section === item.id ? "active" : ""} type="button" key={item.id} onClick={() => props.onSection(item.id)} aria-current={props.section === item.id ? "page" : undefined}>
            <span><Icon name={item.icon} /></span>
            {t(item.label)}
          </button>
        ))}
      </nav>
    </div>
  );
}

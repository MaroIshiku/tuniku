import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon.js";
import { useI18n } from "../lib/i18n.js";

export function Sheet(props: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("sheet-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("sheet-open");
    };
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <h2 id="sheet-title">{props.title}</h2>
          <button className="icon-button" type="button" aria-label={t("close")} onClick={props.onClose}><Icon name="close" /></button>
        </header>
        <div className="sheet-content">{props.children}</div>
      </aside>
    </div>
  );
}

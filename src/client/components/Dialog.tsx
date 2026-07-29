import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon.js";
import { useI18n } from "../lib/i18n.js";

export function Dialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string | undefined;
  danger?: boolean | undefined;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading">
          <h2 id="dialog-title">{props.title}</h2>
          <button className="icon-button" type="button" aria-label={t("close")} onClick={props.onClose}><Icon name="close" /></button>
        </div>
        <div className="dialog-content">{props.children}</div>
        <div className="dialog-actions">
          <button className="button button-text" type="button" onClick={props.onClose}>{t("cancel")}</button>
          <button className={`button ${props.danger ? "button-danger" : "button-filled"}`} type="button" onClick={props.onConfirm}>
            {props.confirmLabel || t("confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}

import { useId, type ReactNode } from "react";
import { useModal } from "../lib/useModal.js";
import { Icon } from "./Icon.js";
import { useI18n } from "../lib/i18n.js";

export function Sheet(props: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useModal(props.open, props.onClose);
  const titleId = useId();
  if (!props.open) return null;
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <h2 id={titleId}>{props.title}</h2>
          <button className="icon-button" type="button" aria-label={t("close")} onClick={props.onClose}><Icon name="close" /></button>
        </div>
        <div className="sheet-content">{props.children}</div>
      </section>
    </div>
  );
}

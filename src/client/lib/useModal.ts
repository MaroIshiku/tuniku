import { useEffect, useRef } from "react";

const openModals: HTMLElement[] = [];
let bodyOverflow = "";
const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const modal = ref.current;
    if (!open || !modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openModals.length === 0) bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openModals.push(modal);
    const controls = () => [...modal.querySelectorAll<HTMLElement>(focusable)].filter((item) => item.getClientRects().length && !item.closest("[inert]"));
    (controls()[0] ?? modal).focus();
    const onKey = (event: KeyboardEvent) => {
      if (openModals.at(-1) !== modal) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0] ?? modal, last = items.at(-1) ?? modal;
      if (!modal.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last) || !items.length) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (openModals.at(-1) === modal && !modal.contains(event.target as Node)) (controls()[0] ?? modal).focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      openModals.splice(openModals.indexOf(modal), 1);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      if (openModals.length === 0) document.body.style.overflow = bodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  return ref;
}

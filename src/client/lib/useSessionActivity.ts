import { useEffect } from "react";
import { api } from "./api.js";

export function useSessionActivity(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let lastSent = -Infinity;
    let timeout: number | undefined;
    let active = true;
    const send = () => {
      timeout = undefined;
      if (!active || document.visibilityState !== "visible") return;
      lastSent = Date.now();
      void api.touchActivity().catch(() => { /* Expired sessions are handled by the API client. No automatic retries. */ });
    };
    const interaction = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      const remaining = 15_000 - (Date.now() - lastSent);
      if (remaining <= 0) send();
      else if (timeout === undefined) timeout = window.setTimeout(send, remaining);
    };
    for (const event of ["pointerdown", "keydown", "wheel"]) document.addEventListener(event, interaction, { passive: true });
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
      for (const event of ["pointerdown", "keydown", "wheel"]) document.removeEventListener(event, interaction);
    };
  }, [enabled]);
}

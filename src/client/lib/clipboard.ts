export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.inset = "-9999px auto auto -9999px";
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  (dialogs[dialogs.length - 1] ?? document.body).append(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Copy is unavailable in this browser. Select and copy the text manually.");
  } finally {
    field.value = "";
    field.remove();
    previousFocus?.focus();
  }
}

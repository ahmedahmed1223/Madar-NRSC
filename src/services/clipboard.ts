/** Copies text in secure contexts and falls back for embedded or restricted browser windows. */
export async function copyTextToClipboard(text: string, trigger?: HTMLButtonElement): Promise<boolean> {
  // WebKit does not focus a button on pointer activation. Set focus now, while
  // handling that activation, so a later clipboard response cannot steal it.
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Embedded previews can deny clipboard permissions even when the API exists.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false;
  if (trigger && !document.hasFocus()) return false;
  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;inset-inline-start:-9999px;top:0;opacity:0;';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    const needsFocusRestore = document.activeElement === textarea;
    textarea.remove();
    if (needsFocusRestore && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }
  return copied;
}

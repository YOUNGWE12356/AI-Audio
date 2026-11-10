export async function copyText(text: string): Promise<boolean> {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const input = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused : null;
  const inputSelection = input ? [input.selectionStart, input.selectionEnd] as const : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(textarea);
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };
  document.addEventListener('copy', handleCopy);
  let copied = false;
  try {
    // LAN HTTP and embedded browsers may not expose the asynchronous Clipboard API.
    textarea.focus();
    textarea.select();
    copied = document.execCommand('copy');
  } catch { /* Try the modern API below. */ }
  finally {
    document.removeEventListener('copy', handleCopy);
    textarea.remove();
    focused?.focus({ preventScroll: true });
    if (input && inputSelection && inputSelection[0] !== null && inputSelection[1] !== null) {
      input.setSelectionRange(inputSelection[0], inputSelection[1]);
    } else if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
  if (!copied) {
    try { await navigator.clipboard.writeText(text); copied = true; }
    catch { /* Report failure to the caller. */ }
  }
  return copied;
}

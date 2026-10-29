// The WebView's own menu (back, reload, inspect) is noise in a desktop app. Custom menus
// call preventDefault first; anything left unhandled is swallowed, except editable fields.
export function installNativeMenuGuard(doc: Document = document): () => void {
    const onMenu = (e: Event) => {
        if (e.defaultPrevented) return;
        const t = e.target as Element | null;
        if (t?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
        e.preventDefault();
    };
    doc.addEventListener('contextmenu', onMenu);
    return () => doc.removeEventListener('contextmenu', onMenu);
}

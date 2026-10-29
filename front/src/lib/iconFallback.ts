const BLANK_CC_ICON = '/icons/cc/1110.png';
const TRANSPARENT_PX =
    'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Swaps any failed /icons/ image for CC 1110's blank icon, then a transparent
 * pixel if that is missing too. Returns a remover.
 */
export function installIconFallback(doc: Document = document): () => void {
    const handler = (e: Event) => {
        const img = e.target as HTMLImageElement | null;
        if (!img || img.tagName !== 'IMG' || !img.src.includes('/icons/')) return;
        if (img.src.endsWith(BLANK_CC_ICON)) img.src = TRANSPARENT_PX;
        else if (img.src !== TRANSPARENT_PX) img.src = BLANK_CC_ICON;
    };
    doc.addEventListener('error', handler, true);
    return () => doc.removeEventListener('error', handler, true);
}

export interface HighlightPart { text: string; hit: boolean }

// Splits text around case-insensitive matches of query for <mark>-style rendering.
export function highlightParts(text: string, query: string): HighlightPart[] {
    const q = query.trim().toLowerCase();
    if (!q) return [{ text, hit: false }];
    const lower = text.toLowerCase();
    const out: HighlightPart[] = [];
    let from = 0;
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, from)) {
        if (i > from) out.push({ text: text.slice(from, i), hit: false });
        out.push({ text: text.slice(i, i + q.length), hit: true });
        from = i + q.length;
    }
    if (from < text.length) out.push({ text: text.slice(from), hit: false });
    return out;
}

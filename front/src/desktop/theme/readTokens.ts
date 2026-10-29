// Resolve CSS variables to concrete values, e.g. for ECharts options.
export function readTokens(names: string[]): Record<string, string> {
    const style = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const n of names) {
        out[n] = style.getPropertyValue(n).trim();
    }
    return out;
}

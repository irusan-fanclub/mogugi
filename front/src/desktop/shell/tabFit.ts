// Decides which tabs stay in the bar. Selected tab is always visible: when
// it would be collapsed it takes the place of the last visible tab.
export function fitTabs(widths: number[], container: number, pinned: number, more: number, selected: number): number[] {
    const all = widths.map((_, i) => i);
    const total = widths.reduce((a, b) => a + b, 0);
    if (total <= container - pinned) return all;

    const room = container - pinned - more;
    let n = 0;
    let used = 0;
    while (n < widths.length && used + widths[n] <= room) used += widths[n++];

    const visible = all.slice(0, n);
    if (selected >= 0 && !visible.includes(selected)) {
        if (visible.length > 0) visible.pop();
        visible.push(selected);
    }
    return visible;
}

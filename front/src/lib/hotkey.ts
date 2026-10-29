// Same accepted shape and canonical form as Go normalizeHotkey (internal/desktop/hotkey.go).
type KeyEv = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

function keyFromCode(code: string): string | null {
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    m = /^F([1-9]|1[0-2])$/.exec(code);
    if (m) return 'F' + m[1];
    return null;
}

/** Hotkey string for a keydown, or null for modifier-only or unsupported combinations. */
export function keyEventToHotkey(e: KeyEv): string | null {
    const key = keyFromCode(e.code);
    if (!key || e.metaKey || (!e.ctrlKey && !e.altKey)) return null;
    const out: string[] = [];
    if (e.ctrlKey) out.push('Ctrl');
    if (e.altKey) out.push('Alt');
    if (e.shiftKey) out.push('Shift');
    out.push(key);
    return out.join('+');
}

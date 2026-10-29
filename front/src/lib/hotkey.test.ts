import { describe, it, expect } from 'vitest';
import { keyEventToHotkey } from './hotkey';

const ev = (o: Partial<Parameters<typeof keyEventToHotkey>[0]>) => ({
    key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o,
});

describe('keyEventToHotkey', () => {
    it('builds canonical strings', () => {
        expect(keyEventToHotkey(ev({ code: 'KeyL', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+L');
        expect(keyEventToHotkey(ev({ code: 'F9', altKey: true, shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Alt+Shift+F9');
        expect(keyEventToHotkey(ev({ code: 'Digit1', ctrlKey: true }))).toBe('Ctrl+1');
    });
    it('rejects invalid shapes', () => {
        expect(keyEventToHotkey(ev({ code: 'KeyL', shiftKey: true }))).toBeNull();
        expect(keyEventToHotkey(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
        expect(keyEventToHotkey(ev({ code: 'Space', ctrlKey: true }))).toBeNull();
        expect(keyEventToHotkey(ev({ code: 'F13', ctrlKey: true }))).toBeNull();
        expect(keyEventToHotkey(ev({ code: 'KeyL', ctrlKey: true, metaKey: true }))).toBeNull();
    });
});

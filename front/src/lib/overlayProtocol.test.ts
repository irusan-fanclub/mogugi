import { describe, expect, it } from 'vitest';
import { isOverlayState, OV } from './overlayProtocol';

const good = {
    locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '',
    hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '',
    layout: { dps: { enabled: true, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 8 } },
    gameFound: true,
};

describe('isOverlayState', () => {
    it('accepts a payload with layout and gameFound', () => {
        expect(isOverlayState(good)).toBe(true);
        expect(isOverlayState({ ...good, layout: {} })).toBe(true);
    });
    it('rejects a payload without gameFound', () => {
        const { gameFound: _g, ...rest } = good;
        expect(isOverlayState(rest)).toBe(false);
    });
    it('rejects a payload without layout', () => {
        const { layout: _l, ...rest } = good;
        expect(isOverlayState(rest)).toBe(false);
    });
});

describe('OV', () => {
    it('has setLayout and no setEnabled', () => {
        expect(OV.setLayout).toBe('overlay:set-layout');
        expect('setEnabled' in OV).toBe(false);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { OverlayLayout, OverlayState } from '@/lib/overlayProtocol';

const state = ref<OverlayState | null>(null);
const replaceLayouts = vi.fn();
vi.mock('./useOverlayState', () => ({ useOverlayState: () => ({ state, replaceLayouts }) }));

import { frameField, defaultFrameRec } from '@/lib/overlayFrames';
import { startFrameRecords } from './frameRecords';

const L = (o: Partial<OverlayLayout> = {}): OverlayLayout => ({ enabled: true, anchor: 'tl', x: 1, y: 2, width: 120, maxRows: 1, ...o });
const emit = (layout: Record<string, OverlayLayout>) => { state.value = { layout } as unknown as OverlayState; };

describe('startFrameRecords', () => {
    let stop: () => void;
    beforeEach(() => {
        stop?.();
        replaceLayouts.mockClear();
        state.value = null;
    });

    it('records legacy groups and units in one call', async () => {
        emit({ 'ccParty-g1': L(), 'ccParty-g2': L(), 'ccParty-476': L() });
        stop = startFrameRecords();
        await nextTick();
        expect(replaceLayouts).toHaveBeenCalledTimes(1);
        const [saves, removes] = replaceLayouts.mock.calls[0];
        expect(Object.keys(saves).sort()).toEqual(['ccParty-476', 'ccParty-g1', 'ccParty-g2']);
        expect(removes).toEqual([]);
    });

    it('does nothing when every frame has a record', async () => {
        const frame = frameField(defaultFrameRec('ccParty', 'group', 1));
        emit({ 'ccParty-g1': L({ frame }) });
        stop = startFrameRecords();
        await nextTick();
        expect(replaceLayouts).not.toHaveBeenCalled();
    });

    it('sends only a newly appeared unit later', async () => {
        const frame = frameField(defaultFrameRec('ccParty', 'group', 1));
        emit({ 'ccParty-g1': L({ frame }) });
        stop = startFrameRecords();
        await nextTick();
        emit({ 'ccParty-g1': L({ frame }), 'ccParty-476': L() });
        await nextTick();
        expect(replaceLayouts).toHaveBeenCalledTimes(1);
        expect(Object.keys(replaceLayouts.mock.calls[0][0])).toEqual(['ccParty-476']);
    });

    it('skips an identical state emitted twice, then resends after it settles', async () => {
        stop = startFrameRecords();
        emit({ 'ccParty-g1': L() });
        await nextTick();
        emit({ 'ccParty-g1': L() });
        await nextTick();
        expect(replaceLayouts).toHaveBeenCalledTimes(1);
        const frame = replaceLayouts.mock.calls[0][0]['ccParty-g1'].frame;
        emit({ 'ccParty-g1': L({ frame }) });
        await nextTick();
        emit({ 'ccParty-g1': L() });
        await nextTick();
        expect(replaceLayouts).toHaveBeenCalledTimes(2);
    });
});

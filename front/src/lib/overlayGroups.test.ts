import { describe, expect, it } from 'vitest';
import type { OverlayLayout } from './overlayProtocol';
import { frameOfKey, groupIdsOf, groupMembers, isGroupOf, nextGroupId, planPlace, planTakeOut, type Layouts } from './overlayGroups';

const L = (o: Partial<OverlayLayout> = {}): OverlayLayout => ({ enabled: true, anchor: 'tl', x: 10, y: 20, width: 120, maxRows: 1, ...o });
const SEC_DEFAULT = L({ x: 24, y: 24, width: 300 });
const KEYS = ['1', '2', '3', '4'];
const ctx = (layouts: Layouts) => ({
    sec: 'ccSelf' as const, layouts, keys: KEYS, sectionOrder: KEYS,
    layoutOf: (id: string) => layouts?.[id] ?? SEC_DEFAULT,
});

describe('ids and membership', () => {
    it('tells group ids from unit ids', () => {
        expect(isGroupOf('ccSelf', 'ccSelf-g1')).toBe(true);
        expect(isGroupOf('ccSelf', 'ccSelf-680')).toBe(false);
        expect(isGroupOf('ccSelf', 'ccParty-g1')).toBe(false);
        expect(isGroupOf('ccSelf', 'ccSelf-gx')).toBe(false);
    });
    it('lists groups by number and finds the next free one', () => {
        const ls = { 'ccSelf-g10': L(), 'ccSelf-g2': L(), 'ccSelf-3': L(), 'ccSelf-g1': L() };
        expect(groupIdsOf('ccSelf', ls)).toEqual(['ccSelf-g1', 'ccSelf-g2', 'ccSelf-g10']);
        expect(nextGroupId('ccSelf', ls)).toBe('ccSelf-g3');
    });
    it('members skip removed items, duplicates and items with a unit frame', () => {
        const ls = { 'ccSelf-g1': L({ order: ['2', '9', '2', '3', '1'] }), 'ccSelf-3': L() };
        expect(groupMembers('ccSelf', 'ccSelf-g1', ls, KEYS)).toEqual(['2', '1']);
        expect(frameOfKey('ccSelf', '3', ls)).toBe('ccSelf-3');
        expect(frameOfKey('ccSelf', '2', ls)).toBe('ccSelf-g1');
        expect(frameOfKey('ccSelf', '4', ls)).toBe('ccSelf');
    });
});

describe('planPlace', () => {
    it('a tile dropped on a unit starts a group where the unit stood', () => {
        const ls = { 'ccSelf-2': L({ x: 50, dock: 'ccBoss' }) };
        const ops = planPlace(ctx(ls), ['1'], 'ccSelf', { frame: 'ccSelf-2', index: 1 });
        expect(ops).toEqual([
            { save: 'ccSelf-g1', layout: L({ x: 50, dock: 'ccBoss', order: ['2', '1'] }) },
            { remove: 'ccSelf-2', heir: 'ccSelf-g1' },
        ]);
    });
    it('a unit dropped on another unit removes its own frame too', () => {
        const ls = { 'ccSelf-2': L(), 'ccSelf-3': L({ x: 99 }) };
        const ops = planPlace(ctx(ls), ['3'], 'ccSelf-3', { frame: 'ccSelf-2', index: 0 });
        expect(ops).toEqual([
            { remove: 'ccSelf-3' },
            { save: 'ccSelf-g1', layout: L({ order: ['3', '2'] }) },
            { remove: 'ccSelf-2', heir: 'ccSelf-g1' },
        ]);
    });
    it('joins a group at the index and reorders inside it', () => {
        const ls = { 'ccSelf-g1': L({ order: ['2', '3'] }) };
        expect(planPlace(ctx(ls), ['4'], 'ccSelf', { frame: 'ccSelf-g1', index: 1 }))
            .toEqual([{ save: 'ccSelf-g1', layout: L({ order: ['2', '4', '3'] }) }]);
        expect(planPlace(ctx(ls), ['3'], 'ccSelf-g1', { frame: 'ccSelf-g1', index: 0 }))
            .toEqual([{ save: 'ccSelf-g1', layout: L({ order: ['3', '2'] }) }]);
        expect(planPlace(ctx(ls), ['2'], 'ccSelf-g1', { frame: 'ccSelf-g1', index: 0 })).toEqual([]);
    });
    it('a group left with one item turns into that unit, which inherits the docked frames', () => {
        const ls = { 'ccSelf-g1': L({ x: 7, order: ['2', '3'] }) };
        expect(planPlace(ctx(ls), ['2'], 'ccSelf-g1', { frame: 'ccSelf', index: 0 })).toEqual([
            { save: 'ccSelf-3', layout: L({ x: 7 }) },
            { remove: 'ccSelf-g1', heir: 'ccSelf-3' },
            { save: 'ccSelf', layout: { ...SEC_DEFAULT, order: ['2', '1', '3', '4'] } },
        ]);
    });
    it('dragged out of a group into free space becomes a unit; the group keeps the rest', () => {
        const ls = { 'ccSelf-g1': L({ order: ['1', '2', '3'] }) };
        const free = L({ x: 300 });
        expect(planPlace(ctx(ls), ['2'], 'ccSelf-g1', { free })).toEqual([
            { save: 'ccSelf-g1', layout: L({ order: ['1', '3'] }) },
            { save: 'ccSelf-2', layout: free },
        ]);
    });
    it('a unit dropped in free space just moves', () => {
        const ls = { 'ccSelf-2': L() };
        expect(planPlace(ctx(ls), ['2'], 'ccSelf-2', { free: L({ x: 1 }) })).toEqual([{ save: 'ccSelf-2', layout: L({ x: 1 }) }]);
    });
    it('several items dragged to free space make a new group', () => {
        const free = L({ x: 300, width: 80 });
        expect(planPlace(ctx({}), ['2', '1'], 'ccSelf', { free })).toEqual([
            { save: 'ccSelf-g1', layout: L({ x: 300, width: 120, order: ['2', '1'] }) },
        ]);
    });
    it('a whole group dragged to free space just moves, keeping its record', () => {
        const ls = { 'ccSelf-g2': L({ order: ['1', '2'], frame: 'F' }) };
        expect(planPlace(ctx(ls), ['1', '2'], 'ccSelf-g2', { free: L({ x: 300, y: 5 }) })).toEqual([
            { save: 'ccSelf-g2', layout: L({ x: 300, y: 5, order: ['1', '2'], frame: 'F' }) },
        ]);
    });
    it('a whole group merges into another group', () => {
        const ls = { 'ccSelf-g1': L({ order: ['1', '2'] }), 'ccSelf-g2': L({ order: ['3', '4'] }) };
        expect(planPlace(ctx(ls), ['1', '2'], 'ccSelf-g1', { frame: 'ccSelf-g2', index: 2 })).toEqual([
            { remove: 'ccSelf-g1' },
            { save: 'ccSelf-g2', layout: L({ order: ['3', '4', '1', '2'] }) },
        ]);
    });
});

describe('planTakeOut', () => {
    it('from the section does nothing; a unit is removed', () => {
        expect(planTakeOut(ctx({}), ['1'], 'ccSelf')).toEqual([]);
        expect(planTakeOut(ctx({ 'ccSelf-1': L() }), ['1'], 'ccSelf-1')).toEqual([{ remove: 'ccSelf-1' }]);
    });
});

describe('frame records follow the layout', () => {
    it('take-out of a two-member group keeps the frame on the surviving unit', () => {
        const ls = { 'ccSelf-g1': L({ order: ['1', '2'], frame: 'X' }) };
        const ops = planTakeOut(ctx(ls), ['1'], 'ccSelf-g1');
        expect(ops[0]).toEqual({ save: 'ccSelf-2', layout: L({ frame: 'X' }) });
    });
    it('a unit dropped on a unit makes a group with the host frame; the dropped one is gone', () => {
        const ls = { 'ccSelf-2': L({ frame: 'B' }), 'ccSelf-3': L({ x: 99, frame: 'A' }) };
        const ops = planPlace(ctx(ls), ['3'], 'ccSelf-3', { frame: 'ccSelf-2', index: 0 });
        expect(ops).toEqual([
            { remove: 'ccSelf-3' },
            { save: 'ccSelf-g1', layout: L({ order: ['3', '2'], frame: 'B' }) },
            { remove: 'ccSelf-2', heir: 'ccSelf-g1' },
        ]);
    });
});

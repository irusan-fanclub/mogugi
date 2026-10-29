import { describe, it, expect } from 'vitest';
import { dpsOf, buildPlayerRows, shareOf } from './battleStats';

const dmg = (At: number, Damage: number, TargetId = 't1') => ({ At, Damage, TargetId } as never);
const actor = (id: string, isPC = true) => ({ id, isPC } as never);

describe('dpsOf', () => {
    it('is 0 for fewer than 2 hits', () => {
        expect(dpsOf(100, [])).toBe(0);
        expect(dpsOf(100, [{ At: 5 }])).toBe(0);
    });
    it('is 0 when the span is 0', () => {
        expect(dpsOf(100, [{ At: 5 }, { At: 5 }])).toBe(0);
    });
    it('divides by first-to-last span', () => {
        expect(dpsOf(100, [{ At: 0 }, { At: 4 }, { At: 10 }])).toBe(10);
    });
});

describe('shareOf', () => {
    it('is a fraction in 0..1 and 0 for an empty whole', () => {
        expect(shareOf(25, 100)).toBe(0.25);
        expect(shareOf(5, 0)).toBe(0);
    });
});

describe('buildPlayerRows', () => {
    const data: Record<string, any[]> = {
        a: [dmg(0, 10), dmg(2, 20, 't2')],
        b: [dmg(1, 100), dmg(3, 50)],
        c: [],
        npc: [dmg(0, 9999)],
    };
    const base = {
        actors: [actor('a'), actor('b'), actor('c'), actor('npc', false)],
        byAttacker: (id: string) => data[id] ?? [],
        targetId: '', minAt: null, maxAt: null,
    };
    it('keeps only PCs with damage, sorted by total desc', () => {
        const rows = buildPlayerRows(base);
        expect(rows.map(r => r.actor.id)).toEqual(['b', 'a']);
        expect(rows[0].totalDamage).toBe(150);
        expect(rows[0].first!.At).toBe(1);
        expect(rows[0].last!.At).toBe(3);
    });
    it('filters by target', () => {
        const rows = buildPlayerRows({ ...base, targetId: 't2' });
        expect(rows.map(r => [r.actor.id, r.totalDamage])).toEqual([['a', 20]]);
    });
    it('filters by time range', () => {
        const rows = buildPlayerRows({ ...base, minAt: 2, maxAt: 3 });
        expect(rows.map(r => [r.actor.id, r.totalDamage])).toEqual([['b', 50], ['a', 20]]);
    });
    it('uses preaggregated totals without rescanning', () => {
        let scanned = 0;
        const rows = buildPlayerRows({
            ...base,
            byAttacker: (id: string) => { scanned++; return data[id] ?? []; },
            preaggregated: (id: string) => id === 'a' ? { damages: data.a, total: 30 }
                : id === 'b' ? { damages: data.b, total: 150 } : { damages: [], total: 0 },
        });
        expect(rows.map(r => [r.actor.id, r.totalDamage])).toEqual([['b', 150], ['a', 30]]);
        expect(rows[0].first).toBe(data.b[0]);
        expect(rows[0].last).toBe(data.b[1]);
        expect(scanned).toBe(0);
    });
});

import { describe, expect, it } from 'vitest';
import { buildCcTiles, buildCooldownTiles, type Holder } from './overlayTiles';
import { defaultCcItem, defaultCcSection, defaultCooldownItem, defaultCooldownSection, type CcItem, type CcSection } from './overlaySections';
import type { CooldownRowVM } from './skillCooldown';

const NOW = 1000;
const cond = (CCId: number, DisableAt: number): any => ({ Id: 'x', At: 0, CCId, DisableAt, AttackerId: '', Params: [] });
const actor = (...cs: any[]): any => ({ conditionMap: Object.fromEntries(cs.map(c => [c.CCId, c])) });
const holder = (id: string, name = id, isSelf = false): Holder => ({ id, name, isSelf });
const item = (o: Partial<CcItem> = {}): CcItem => ({ ...defaultCcItem('ccSelf', 900, 'X'), ...o });
const sec = (items: CcItem[], names: 'label' | 'member' | 'none' = 'label'): CcSection =>
    ({ look: { ...defaultCcSection('ccSelf').look, names }, items });
const base = {
    holders: [holder('A', 'Ann', true)], now: NOW, ownArcana: null as number | null, judgeGone: false,
    arcanaOf: (_id: string): number | null => null,
};
const build = (s: CcSection, actors: Record<string, any>, o: Partial<typeof base> = {}) =>
    buildCcTiles(s, { ...base, actors, ...o });

describe('buildCcTiles', () => {
    describe('信念值', () => {
        const gaugeItem = (o: Partial<CcItem> = {}) => item({ id: 428, ids: [428], icon: { kind: 'cc', id: 428 }, label: '信念', ...o });
        const gauge = (id: string) => id === 'A' ? { value: 40, max: 100 } : null;
        it('before 428 fires: percent on the icon, estimated time below, sweep for what is left', () => {
            const t = build(sec([gaugeItem()]), { A: actor() }, { gauge } as any).get('428')![0];
            expect(t).toMatchObject({ state: 'cooling', sec: '40%', label: '6:00', hl: false, faint: false });
            expect(t.mask).toBeCloseTo(0.6);
        });
        it('the gauge tile keeps its clock text as a fixed label', () => {
            const t = build(sec([gaugeItem()]), { A: actor() }, { gauge } as any).get('428')![0];
            expect(t).toMatchObject({ fixedLabel: true, itemLabel: '信念' });
        });
        it('an active 428 wins over the gauge', () => {
            const t = build(sec([gaugeItem()]), { A: actor(cond(428, NOW + 15)) }, { gauge } as any).get('428')![0];
            expect(t).toMatchObject({ state: 'warn', sec: '15' });
        });
        it('no reading falls back to the usual absent handling', () => {
            expect(build(sec([gaugeItem({ goneHl: false })]), { B: actor() }, { holders: [holder('B')], gauge, judgeGone: true } as any).get('428')).toEqual([]);
        });
    });
    it('ok with 45 s left is faint', () => {
        const t = build(sec([item()]), { A: actor(cond(900, NOW + 45)) }).get('900')![0];
        expect(t).toMatchObject({ state: 'ok', faint: true, sec: '45', hl: false, isSelf: true, holderId: 'A', label: 'X' });
        expect(t).toMatchObject({ itemLabel: 'X', fixedLabel: false });
    });
    it('warn at 20 s', () => {
        const t = build(sec([item()]), { A: actor(cond(900, NOW + 20)) }).get('900')![0];
        expect(t).toMatchObject({ state: 'warn', hl: true, faint: false, sec: '20' });
    });
    it('safe when the renew cc is on the holder', () => {
        const s = sec([item({ renew: 1124 })]);
        const t = build(s, { A: actor(cond(900, NOW + 20), cond(1124, 0)) }).get('900')![0];
        expect(t).toMatchObject({ state: 'safe', hl: true });
    });
    it('warn when the renew cc is on someone else', () => {
        const s = sec([item({ renew: 1124 })]);
        const t = build(s, { A: actor(cond(900, NOW + 20)), B: actor(cond(1124, 0)) }).get('900')![0];
        expect(t.state).toBe('warn');
    });
    it('no expiry is ok with empty seconds', () => {
        const t = build(sec([item()]), { A: actor(cond(900, 0)) }).get('900')![0];
        expect(t).toMatchObject({ state: 'ok', sec: '' });
    });
    it('absent with judgeGone gives a gone tile', () => {
        const t = build(sec([item()]), { A: actor() }, { judgeGone: true }).get('900')!;
        expect(t).toHaveLength(1);
        expect(t[0]).toMatchObject({ state: 'gone', hl: true, faint: false, sec: '' });
    });
    it('absent without judgeGone gives no tile', () => {
        expect(build(sec([item()]), { A: actor() }).get('900')).toEqual([]);
    });
    it('absent with goneHl false gives no tile', () => {
        const s = sec([item({ goneHl: false })]);
        expect(build(s, { A: actor() }, { judgeGone: true }).get('900')).toEqual([]);
    });
    it('multi-id item reports the active id', () => {
        const it = item({ id: 476, ids: [476, 511], icon: { kind: 'cc', id: 476 } });
        const t = build(sec([it]), { A: actor(cond(511, 0)) }).get('476')![0];
        expect(t.icon).toEqual({ kind: 'cc', id: 511 });
    });
    it('multi-id item gone keeps the item icon', () => {
        const it = item({ id: 476, ids: [476, 511], icon: { kind: 'skill', id: 5 } });
        const t = build(sec([it]), { A: actor() }, { judgeGone: true }).get('476')![0];
        expect(t).toMatchObject({ state: 'gone', icon: { kind: 'skill', id: 5 } });
    });
    it('arcana filter', () => {
        const s = sec([item({ arcana: [2] })]);
        const a = { A: actor(cond(900, 0)) };
        expect(build(s, a, { ownArcana: 7 }).get('900')).toBeUndefined();
        expect(build(s, a, { ownArcana: null }).get('900')).toBeUndefined();
        expect(build(s, a, { ownArcana: 2 }).get('900')).toHaveLength(1);
    });
    it('mate arcana keeps only the matching holders', () => {
        const s = sec([item({ mateArcana: [2, 3] })]);
        const hs = [holder('B'), holder('C'), holder('D')];
        const a = { B: actor(cond(900, 0)), C: actor(cond(900, 0)), D: actor(cond(900, 0)) };
        const arc: Record<string, number> = { B: 2, C: 5 };
        const t = build(s, a, { holders: hs, arcanaOf: id => arc[id] ?? null });
        expect(t.get('900')!.map(x => x.holderId)).toEqual(['B']);
    });
    it('mate arcana also filters gone tiles', () => {
        const s = sec([item({ mateArcana: [2] })]);
        const arc: Record<string, number> = { B: 2 };
        const t = build(s, {}, { holders: [holder('B'), holder('C')], judgeGone: true, arcanaOf: id => arc[id] ?? null });
        expect(t.get('900')!.map(x => x.holderId)).toEqual(['B']);
    });
    it('disabled item has no key', () => {
        const m = build(sec([item({ enabled: false })]), { A: actor(cond(900, 0)) });
        expect(m.has('900')).toBe(false);
    });
    it('party labels', () => {
        const hs = [holder('A', 'Ann', true), holder('B', 'Bob')];
        const a = { A: actor(cond(900, 0)), B: actor(cond(900, 0)) };
        const names = (n: 'label' | 'member' | 'none') =>
            build(sec([item()], n), a, { holders: hs }).get('900')!.map(t => t.label);
        expect(names('member')).toEqual(['Ann', 'Bob']);
        expect(names('none')).toEqual(['', '']);
        expect(names('label')).toEqual(['X', 'X']);
    });
    it('keeps settings order', () => {
        const m = build(sec([item({ id: 2, ids: [2] }), item({ id: 1, ids: [1] })]), {});
        expect([...m.keys()]).toEqual(['2', '1']);
    });
});

describe('buildCooldownTiles', () => {
    const row = (id: string, name: string, remaining: number, isSelf = false, total = 60): CooldownRowVM =>
        ({ id, name, isSelf, skills: [{ skillId: 59143, remaining, total }] });
    const cs = (who: 'self' | 'party' | 'all', names = true) => ({
        look: { ...defaultCooldownSection().look, names },
        items: [{ ...defaultCooldownItem(59143), who }],
    });
    const ctx = { ownerId: 'S', partyIds: ['P2', 'P1'], ownArcana: null as number | null };
    const rows = [row('X', 'Zed', 0), row('P1', 'Amy', 0), row('S', 'Me', 0, true), row('P2', 'Bea', 0)];

    it('orders self, party order, then name', () => {
        const t = buildCooldownTiles(cs('all'), rows, ctx).get('59143')!;
        expect(t.map(x => x.holderId)).toEqual(['S', 'P2', 'P1', 'X']);
    });
    it('party excludes outsiders and self keeps self only', () => {
        expect(buildCooldownTiles(cs('party'), rows, ctx).get('59143')!.map(x => x.holderId)).toEqual(['S', 'P2', 'P1']);
        expect(buildCooldownTiles(cs('self'), rows, ctx).get('59143')!.map(x => x.holderId)).toEqual(['S']);
    });
    it('ready tile', () => {
        const t = buildCooldownTiles(cs('self'), rows, ctx).get('59143')![0];
        expect(t).toMatchObject({ sec: 'OK', state: 'ready', hl: true, mask: 0, label: 'Me', isSelf: true, icon: { kind: 'skill', id: 59143 } });
    });
    it('cooling tile', () => {
        const t = buildCooldownTiles(cs('self'), [row('S', 'Me', 12.3, true)], ctx).get('59143')![0];
        expect(t).toMatchObject({ sec: '13', state: 'cooling', hl: false });
        expect(t.mask).toBeCloseTo(0.205, 3);
    });
    it('no names gives empty label', () => {
        expect(buildCooldownTiles(cs('self', false), rows, ctx).get('59143')![0].label).toBe('');
    });
    it('arcana filter and disabled items', () => {
        const s = { ...cs('all'), items: [{ ...defaultCooldownItem(59143), arcana: [2] }, { ...defaultCooldownItem(1), enabled: false }] };
        const m = buildCooldownTiles(s, rows, { ...ctx, ownArcana: 7 });
        expect(m.size).toBe(0);
        expect(buildCooldownTiles(s, rows, { ...ctx, ownArcana: 2 }).get('59143')).toHaveLength(3);
    });
});

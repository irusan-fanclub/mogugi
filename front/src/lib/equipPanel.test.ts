import { describe, it, expect } from 'vitest';
import {
    panelRows, baseUnknown, wornColumns, contribRows, skippedSummary, unmappedSummary, fmt, n,
} from './equipPanel';
import type { SlotEntry } from './equipStats';
import type { ownerPanel } from '@/protocols';

const panel = (over: Partial<ownerPanel> = {}) => ({
    level: 10, combatPower: 100, abilityPoints: 0, life: 50.5, lifeMax: 100, mana: 1, manaMax: 2, stamina: 3, staminaMax: 4,
    str: 10, strMod: 2, dex: 0, dexMod: 0, int: 0, intMod: 0, will: 0, willMod: 0, luck: 0, luckMod: 0,
    attackMin: 1, attackMax: 2, offAttackMin: 3, offAttackMax: 4, injuryMin: 0, injuryMax: 0, critical: 5, balance: 6,
    defenseMod: 0, protectionMod: 0, magicAttackMod: 0, magicDefenseMod: 0, magicProtectionMod: 0, dualWield: false,
    ...over,
}) as unknown as ownerPanel;

const entry = (over: Record<string, unknown> = {}): SlotEntry => ({
    item: { id: 1, strMod: 0, ...over } as never, name: '甲', brief: '', tip: null,
});

describe('equipPanel', () => {
    it('formats numbers: integer as is, otherwise 2 dp; fmt blanks zero', () => {
        expect(n(3)).toBe('3');
        expect(n(1.5)).toBe('1.50');
        expect(fmt(0)).toBe('');
        expect(fmt(undefined)).toBe('');
        expect(fmt(2)).toBe('2');
    });
    it('panelRows: dual wield adds the left-hand row and renames the right', () => {
        const single = panelRows(panel());
        expect(single.map(r => r.label)).toContain('攻擊力');
        expect(single.map(r => r.label)).not.toContain('攻擊力(左手)');
        expect(single.find(r => r.label === '生命力')!.value).toBe('50.50 / 100');
        expect(single.find(r => r.label === '力量')!.value).toBe('10 + 2');
        const dual = panelRows(panel({ dualWield: true }));
        expect(dual.map(r => r.label)).toContain('攻擊力(右手)');
        expect(dual.find(r => r.label === '攻擊力(左手)')!.value).toBe('3 ~ 4');
    });
    it('baseUnknown flags a missing level', () => {
        expect(baseUnknown(panel({ level: 0 }))).toBe(true);
        expect(baseUnknown(panel())).toBe(false);
    });
    it('contribRows: diff = server - sum; null without a panel', () => {
        const cols = wornColumns(new Map([[8, entry({ defense: 4 })]]));
        expect(cols).toHaveLength(1);
        const rows = contribRows(cols, panel());
        const str = rows.find(r => r.key === 'strMod')!;
        expect(str.server).toBe(2);
        expect(str.diff).toBe(2 - str.sum);
        const none = contribRows(cols, null);
        expect(none.every(r => r.server === null && r.diff === null)).toBe(true);
    });
    it('wornColumns follows EQUIP_SLOTS order regardless of input order', () => {
        const cols = wornColumns(new Map([[9, entry()], [5, entry()], [8, entry()]]));
        expect(cols.map(c => c.pocket)).toEqual([8, 5, 9]);
    });
    it('summaries are empty without skipped or unmapped effects', () => {
        const cols = wornColumns(new Map([[8, entry()]]));
        expect(skippedSummary(cols)).toBe('');
        expect(unmappedSummary(cols)).toBe('');
    });
});

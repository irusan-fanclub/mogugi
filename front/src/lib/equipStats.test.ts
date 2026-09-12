// equipStats.test.ts — per-item stat contributions (vitest, pure logic).
import { describe, it, expect } from 'vitest';
import { contributionsOf, sumContributions, panelValue, EQUIP_SLOTS } from './equipStats';
import type { IndexItem } from './itemIndex';
import type { ownerPanel } from '@/protocols';

function item(partial: Partial<IndexItem>): IndexItem {
    return { id: 1, qty: 1, storage: 'inventory', container: 'equip', x: 0, y: 0, ...partial };
}

function panel(partial: Partial<ownerPanel>): ownerPanel {
    return {
        combatPower: 0, life: 0, lifeMax: 0, lifeMaxMod: 0, mana: 0, manaMax: 0, manaMaxMod: 0,
        stamina: 0, staminaMax: 0, staminaMaxMod: 0, level: 0, abilityPoints: 0,
        str: 0, dex: 0, int: 0, will: 0, luck: 0, strMod: 0, dexMod: 0, intMod: 0, willMod: 0, luckMod: 0,
        dualWield: false, attackMin: 0, attackMax: 0, offAttackMin: 0, offAttackMax: 0,
        injuryMin: 0, injuryMax: 0, critical: 0, balance: 0,
        magicAttackMod: 0, defenseMod: 0, protectionMod: 0, magicDefenseMod: 0, magicProtectionMod: 0,
        ...partial,
    };
}

describe('EQUIP_SLOTS', () => {
    it('lists the 20 worn pockets once each', () => {
        const pockets = EQUIP_SLOTS.map(s => s.pocket).sort((a, b) => a - b);
        expect(pockets).toEqual([5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 32, 33, 34, 35, 51, 54, 62, 63, 64]);
    });
});

describe('contributionsOf', () => {
    it('armour: defense/protection, magic def/prot from metadata, effect lines by param code', () => {
        const c = contributionsOf(item({
            id: 16009, defense: 1, protection: 2,
            suffixEffects: [{ code: 16, value: 5 }, { code: 19, value: 2 }],
            blessEffects: [{ code: 1, value: 20 }],
            metalware: [{ id: 4300106, level: 8 }],
            metadata: 'MDEF:f:3.5;MPROT:f:1.25;OWNER:s:x;',
        }), 6);
        expect(c.stats).toEqual({ defense: 1, protection: 2, magicDefense: 3.5, magicProtection: 1.25, attackMax: 5, critical: 2, lifeMax: 20 });
        expect(c.skipped).toEqual({ conditional: 0, metalware: 1, relic: 0 });
        expect(c.unmapped).toEqual([]);
    });

    it('weapon in the active hand counts attack, in the back set it does not', () => {
        const sword = item({ id: 40005, attackMin: 201, attackMax: 255, balance: 60, critical: 30, injuryMin: 10, injuryMax: 30 });
        expect(contributionsOf(sword, 10).stats).toEqual({ attackMin: 201, attackMax: 255, balance: 60, critical: 30 });
        expect(contributionsOf(sword, 11).stats).toEqual({});
    });

    it('a back-set weapon does not contribute defense/protection either', () => {
        const shield = item({ id: 40100, defense: 10, protection: 5 });
        expect(contributionsOf(shield, 13).stats).toEqual({ defense: 10, protection: 5 });
        expect(contributionsOf(shield, 14).stats).toEqual({});
    });

    it('conditional effect lines are counted, not added; unknown codes go to unmapped', () => {
        const c = contributionsOf(item({
            prefixEffects: [{ code: 16, value: 10, condSkill: 21001, condRank: 6 }, { code: 999, value: 3 }],
        }), 5);
        expect(c.stats).toEqual({});
        expect(c.skipped.conditional).toBe(1);
        expect(c.unmapped).toEqual([{ code: 999, value: 3 }]);
    });

    it('relic effects are counted as skipped', () => {
        const c = contributionsOf(item({ relicEffects: [{ code: 1, value: 50 }] }), 32);
        expect(c.stats).toEqual({});
        expect(c.skipped.relic).toBe(1);
    });

    it('zero fields do not create entries', () => {
        expect(contributionsOf(item({ defense: 0, protection: 0 }), 5).stats).toEqual({});
    });
});

describe('sumContributions', () => {
    it('adds per key across items', () => {
        const a = contributionsOf(item({ defense: 1, protection: 2 }), 5);
        const b = contributionsOf(item({ defense: 3, suffixEffects: [{ code: 20, value: 1 }] }), 8);
        expect(sumContributions([a, b])).toEqual({ defense: 4, protection: 3 });
    });
});

describe('panelValue', () => {
    it('maps mod keys to mod fields and weapon keys to totals', () => {
        const p = panel({ strMod: 12, lifeMaxMod: 30, attackMax: 280, defenseMod: 9, magicProtectionMod: 4 });
        expect(panelValue(p, 'strMod')).toEqual({ value: 12, isTotal: false });
        expect(panelValue(p, 'lifeMax')).toEqual({ value: 30, isTotal: false });
        expect(panelValue(p, 'attackMax')).toEqual({ value: 280, isTotal: true });
        expect(panelValue(p, 'defense')).toEqual({ value: 9, isTotal: false });
        expect(panelValue(p, 'magicProtection')).toEqual({ value: 4, isTotal: false });
    });
});

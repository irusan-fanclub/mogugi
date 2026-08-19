import { describe, it, expect } from 'vitest';
import { DamageCollectorManager } from './actionCollector';
import type { EntityDamage } from './eventActor';

const dmg = (id: string, damage = 10): EntityDamage => ({
    Id: id, At: 1000, TargetId: 'boss', SkillId: 1, Damage: damage,
    IsCritical: false, IsDelayed: false, Conditions: [], TargetConditions: [], PetId: '',
});

/** Counts how often the manager walks damages past a collector. */
const countingManager = () => {
    const mgr = new DamageCollectorManager();
    let calls = 0;
    return {
        mgr,
        watch: () => { mgr.getFilteredDamageCollector(() => { calls++; return true; }); },
        calls: () => calls,
    };
};

describe('DamageCollectorManager.reattribute', () => {
    it('moves an unowned unit\'s damage onto its owner', () => {
        const mgr = new DamageCollectorManager();
        mgr.onDamage(dmg('puppet'));
        mgr.onDamage(dmg('someone-else'));

        expect(mgr.reattribute('puppet', 'owner')).toBe(true);
        expect(mgr.damages.map(d => d.Id)).toEqual(['owner', 'someone-else']);
    });

    it('tags the moved damage as the pet\'s, or as the owner\'s own', () => {
        const mgr = new DamageCollectorManager();
        mgr.onDamage(dmg('pet'));
        mgr.reattribute('pet', 'owner', 'pet');
        expect(mgr.damages[0].PetId).toBe('pet');

        const summon = new DamageCollectorManager();
        summon.onDamage(dmg('puppet'));
        summon.reattribute('puppet', 'owner');
        expect(summon.damages[0].PetId).toBe('');
    });

    // The hot path: an appear packet normally beats the unit's first hit, so
    // this fires once per summon with nothing to move. Counting Id reads, not
    // collector rebuilds — a scan that finds nothing never rebuilds either way,
    // so a rebuild counter cannot tell the two apart.
    it('does not walk the damage array when the unit never dealt damage', () => {
        const mgr = new DamageCollectorManager();
        let reads = 0;
        for (let i = 0; i < 50; i++) {
            const d = dmg('someone-else');
            Object.defineProperty(d, 'Id', {
                get() { reads++; return 'someone-else'; }, configurable: true,
            });
            mgr.onDamage(d);
        }
        reads = 0; // onDamage reads Id itself; only the reattribute matters

        expect(mgr.reattribute('never-hit-anything', 'owner')).toBe(false);
        expect(reads).toBe(0);
    });

    it('still rebuilds collectors when damage really moved', () => {
        const { mgr, watch, calls } = countingManager();
        mgr.onDamage(dmg('puppet'));
        watch();
        const before = calls();

        expect(mgr.reattribute('puppet', 'owner')).toBe(true);
        expect(calls()).toBeGreaterThan(before);
    });

    // Without this the index would still name the old id, so a second move —
    // owner reattributed onward — would take the skip path and silently no-op.
    it('follows the damage to its new id', () => {
        const mgr = new DamageCollectorManager();
        mgr.onDamage(dmg('puppet'));
        mgr.reattribute('puppet', 'owner');

        expect(mgr.reattribute('owner', 'party-leader')).toBe(true);
        expect(mgr.damages[0].Id).toBe('party-leader');
        expect(mgr.reattribute('puppet', 'anyone')).toBe(false);
    });

    it('forgets everything on clear', () => {
        const mgr = new DamageCollectorManager();
        mgr.onDamage(dmg('puppet'));
        mgr.clear();
        expect(mgr.reattribute('puppet', 'owner')).toBe(false);
    });
});

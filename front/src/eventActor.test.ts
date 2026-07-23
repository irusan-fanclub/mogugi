// eventActor.test.ts — damage attribution for pets and summoned units (vitest).
import { describe, it, expect } from 'vitest';
import { ActorManager, type EntityDamage } from './eventActor';
import { DamageCollectorManager } from './actionCollector';
import * as protocols from './protocols';

const PC_ID = '4503599630022047';
const PET_ID = '4504699143373502';
const PUPPET_ID = '4767482418118415';
const MOB_ID = '4767482418117579';

function appear(partial: Partial<protocols.eventEntityAppear> & { Id: string, RaceId: number }): protocols.eventEntityAppear {
    return {
        EventId: 1,
        At: 1784805881,
        Name: `n:${partial.Id}`,
        Height: 1,
        Weight: 1,
        Upper: 1,
        Lower: 1,
        GuildName: '',
        OwnerId: '',
        SummonerId: '',
        ...partial,
    };
}

function damage(attackerId: string, skillId: number, amount: number): protocols.eventDamage {
    return {
        EventId: 3,
        At: 1784805900,
        Id: attackerId,
        TargetId: MOB_ID,
        SkillId: skillId,
        Damage: amount,
        IsCritical: false,
        IsDelayed: false,
    };
}

function setup() {
    const dc = new DamageCollectorManager();
    const mgr = new ActorManager(dc);
    mgr.onEvent(appear({ Id: MOB_ID, RaceId: 4856 }));
    mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
    return { dc, mgr };
}

function collected(dc: DamageCollectorManager): EntityDamage[] {
    return dc.damages;
}

describe('damage attribution', () => {
    it('keeps a plain PC hit on the PC', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(damage(PC_ID, 58101, 6912));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
        expect(collected(dc)[0].PetId).toBe('');
    });

    it('redirects pet damage to the owner and tags it as pet damage', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PET_ID, RaceId: 490359, OwnerId: PC_ID }));
        mgr.onEvent(damage(PET_ID, 50249, 186));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
        expect(collected(dc)[0].PetId).toBe(PET_ID);
    });

    // 人偶 (marionette): the appear packet carries no pet-owner, the link comes
    // from the summon packet. Its damage is the summoner's own damage, so it
    // must not be tagged as pet damage (the pet-free DPS chart would drop it).
    it('redirects marionette damage to the summoner as own damage', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, SummonerId: PC_ID }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
        expect(collected(dc)[0].PetId).toBe('');
    });

    it('leaves an unlinked summon on itself', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PUPPET_ID);
    });

    it('picks up a summoner link that arrives after the first appear', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, SummonerId: PC_ID }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
    });

    // The summon packet lands seconds after the marionette has already hit, so
    // damage collected in between has to be moved onto the summoner.
    it('re-attributes damage dealt before the summoner link arrived', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));
        mgr.onEvent(damage(PUPPET_ID, 59169, 5698));

        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, SummonerId: PC_ID }));

        expect(collected(dc).map(d => d.Id)).toEqual([PC_ID, PC_ID]);
        expect(collected(dc).every(d => d.PetId === '')).toBe(true);
    });

    it('rebuilds collectors created before the summoner link arrived', () => {
        const { dc, mgr } = setup();
        const pcDc = dc.getGroupedDamageCollector(d => d.Id === PC_ID, d => d.TargetId);

        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));
        mgr.onEvent(damage(PC_ID, 59164, 8990));
        expect(pcDc.totalDamage).toBe(8990);

        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, SummonerId: PC_ID }));

        expect(pcDc.totalDamage).toBe(29043);
        expect(pcDc.count).toBe(2);
        expect(pcDc.groupedTotalDamages[MOB_ID]).toBe(29043);
    });

    it('leaves other entities untouched when re-attributing', () => {
        const { dc, mgr } = setup();
        const puppetDc = dc.getGroupedDamageCollector(d => d.Id === PUPPET_ID, d => d.TargetId);

        mgr.onEvent(appear({ Id: PET_ID, RaceId: 490359, OwnerId: PC_ID }));
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PET_ID, 50249, 186));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, SummonerId: PC_ID }));

        expect(puppetDc.totalDamage).toBe(0);
        const petHit = collected(dc).find(d => d.PetId === PET_ID);
        expect(petHit?.Id).toBe(PC_ID);
        expect(collected(dc)).toHaveLength(2);
    });
});

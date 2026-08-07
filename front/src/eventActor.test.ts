// eventActor.test.ts — damage attribution for pets and summoned units (vitest).
import { describe, it, expect, beforeEach } from 'vitest';
import { ActorManager, type EntityDamage } from './eventActor';
import { DamageCollectorManager } from './actionCollector';
import * as protocols from './protocols';
import { prettyEntityName } from './lib/util';
import { ref } from 'vue';
import { setAlias, clearAllAliases } from './lib/entityAlias';

const PC_ID = '4503599630022047';
const PET_ID = '4504699143373502';
const PUPPET_ID = '4767482418118415';
const MOB_ID = '4767482418117579';
// A second mob the meter has not seen an appear packet for yet.
const FRESH_MOB_ID = '4767482418117582';

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
        ...partial,
    };
}

function damage(attackerId: string, skillId: number, amount: number, targetId = MOB_ID): protocols.eventDamage {
    return {
        EventId: 3,
        At: 1784805900,
        Id: attackerId,
        TargetId: targetId,
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

    // 人偶 (marionette): the appear packet's owner id is the summoner. Its
    // damage is the owner's own output, so it must not be tagged as pet damage
    // (the pet-free DPS chart would otherwise drop it).
    it('redirects marionette damage to the owner as own damage', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, OwnerId: PC_ID }));
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

    it('picks up an owner that arrives after the first appear', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, OwnerId: PC_ID }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
    });

    // The appear packet lands after the marionette has already hit, so damage
    // collected in between has to be moved onto the owner.
    it('re-attributes damage dealt before the owner was known', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));
        mgr.onEvent(damage(PUPPET_ID, 59169, 5698));

        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, OwnerId: PC_ID }));

        expect(collected(dc).map(d => d.Id)).toEqual([PC_ID, PC_ID]);
        expect(collected(dc).every(d => d.PetId === '')).toBe(true);
    });

    it('rebuilds collectors created before the owner was known', () => {
        const { dc, mgr } = setup();
        const pcDc = dc.getGroupedDamageCollector(d => d.Id === PC_ID, d => d.TargetId);

        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));
        mgr.onEvent(damage(PC_ID, 59164, 8990));
        expect(pcDc.totalDamage).toBe(8990);

        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, OwnerId: PC_ID }));

        expect(pcDc.totalDamage).toBe(29043);
        expect(pcDc.count).toBe(2);
        expect(pcDc.groupedTotalDamages[MOB_ID]).toBe(29043);
    });

    // A real pet (not a summon race) that hit before its appear must be moved
    // onto the owner AND tagged as pet damage, so the pet-free views drop it.
    it('re-attributes a pre-appear pet hit onto the owner with the pet tag', () => {
        const { dc, mgr } = setup();
        mgr.onEvent(damage(PET_ID, 50249, 186));
        expect(collected(dc)[0].Id).toBe(PET_ID);
        expect(collected(dc)[0].PetId).toBe('');

        mgr.onEvent(appear({ Id: PET_ID, RaceId: 490359, OwnerId: PC_ID }));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
        expect(collected(dc)[0].PetId).toBe(PET_ID);
    });

    it('leaves other entities untouched when re-attributing', () => {
        const { dc, mgr } = setup();
        const puppetDc = dc.getGroupedDamageCollector(d => d.Id === PUPPET_ID, d => d.TargetId);

        mgr.onEvent(appear({ Id: PET_ID, RaceId: 490359, OwnerId: PC_ID }));
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216 }));
        mgr.onEvent(damage(PET_ID, 50249, 186));
        mgr.onEvent(damage(PUPPET_ID, 59169, 20053));
        mgr.onEvent(appear({ Id: PUPPET_ID, RaceId: 990216, OwnerId: PC_ID }));

        expect(puppetDc.totalDamage).toBe(0);
        const petHit = collected(dc).find(d => d.PetId === PET_ID);
        expect(petHit?.Id).toBe(PC_ID);
        expect(collected(dc)).toHaveLength(2);
    });
});

describe('entities the meter never saw appear', () => {
    // mogugi started after the player was already in the map, so their own
    // EntityAppear never arrives. Their damage must still be counted.
    it('counts damage from a character-class attacker that never appeared', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: MOB_ID, RaceId: 4856 }));

        mgr.onEvent(damage(PC_ID, 58101, 2597693));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Id).toBe(PC_ID);
        expect(mgr.entityMap[PC_ID]?.isPC).toBe(true);
    });

    it('does not invent a player row for a monster-class attacker', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002 }));

        mgr.onEvent(damage(FRESH_MOB_ID, 20001, 500));

        // The hit is kept, but the stand-in must not pass for a player or the
        // monster shows up in the DPS ranking.
        expect(collected(dc)).toHaveLength(1);
        expect(mgr.entityMap[FRESH_MOB_ID].isPC).toBe(false);
    });

    it('keeps each unidentified monster in its own group', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002 }));

        mgr.onEvent(damage(PC_ID, 59167, 100, MOB_ID));
        mgr.onEvent(damage(PC_ID, 59167, 100, FRESH_MOB_ID));

        expect(mgr.entityMap[MOB_ID].group).not.toBe(mgr.entityMap[FRESH_MOB_ID].group);
    });

    it('replaces the placeholder when the real appear arrives, without double counting', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: MOB_ID, RaceId: 4856 }));

        mgr.onEvent(damage(PC_ID, 58101, 2597693));
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002, Name: '蘑菇嫩煎雞' }));

        expect(collected(dc)).toHaveLength(1);
        expect(mgr.entityMap[PC_ID].name).toBe('蘑菇嫩煎雞');
        expect(mgr.entityMap[PC_ID].isPC).toBe(true);
    });

    // The 死神 burst AoEs a batch of freshly spawned mobs; each mob's first
    // hit used to be dropped because the placeholder target was only created
    // after onApplyDamage had already bailed out.
    it('counts the first hit on a target it has not seen yet', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002 }));

        mgr.onEvent(damage(PC_ID, 59167, 518228, FRESH_MOB_ID));

        expect(collected(dc)).toHaveLength(1);
        expect(collected(dc)[0].Damage).toBe(518228);
    });

    it('stops treating a placeholder as a player once its real race arrives', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002 }));

        // Placeholder target is created as a character; the real appear says wolf.
        mgr.onEvent(damage(PC_ID, 59167, 100, FRESH_MOB_ID));
        expect(mgr.entityMap[FRESH_MOB_ID]).toBeDefined();

        mgr.onEvent(appear({ Id: FRESH_MOB_ID, RaceId: 20001, Name: '灰狼' }));

        expect(mgr.entityMap[FRESH_MOB_ID].isPC).toBe(false);
    });
});

describe('prettyEntityName for unidentified placeholders', () => {
    const raceNameMap = ref<Record<number, string>>({});

    function withHit(targetId: string) {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002 }));
        mgr.onEvent(damage(PC_ID, 59167, 100, targetId));
        return mgr;
    }

    // Every unknown mob shares raceId 0, so naming by race would collapse them
    // all into one identical label. Keep them distinct by the id tail.
    it('gives each unknown mob a distinct label instead of unknownRace:0', () => {
        const a = withHit(MOB_ID).entityMap[MOB_ID];
        const b = withHit(FRESH_MOB_ID).entityMap[FRESH_MOB_ID];

        const na = prettyEntityName(a, raceNameMap)!;
        const nb = prettyEntityName(b, raceNameMap)!;
        expect(na).not.toContain('unknownRace');
        expect(na).not.toBe(nb);
    });

    it('labels the unknown group the same way as its entity', () => {
        const mgr = withHit(MOB_ID);
        const entity = mgr.entityMap[MOB_ID];
        expect(prettyEntityName(entity.group, raceNameMap))
            .toBe(prettyEntityName(entity, raceNameMap));
    });

    it('still names an identified monster by its race', () => {
        const mgr = withHit(MOB_ID);
        // Real mob appear packets carry a numeric name.
        mgr.onEvent(appear({ Id: MOB_ID, RaceId: 20001, Name: MOB_ID }));
        raceNameMap.value = { 20001: '灰狼' };
        expect(prettyEntityName(mgr.entityMap[MOB_ID], raceNameMap)).toContain('灰狼');
    });
});

describe('prettyEntityName with aliases', () => {
    const raceNameMap = ref<Record<number, string>>({ 20001: '灰狼' });

    function mgrWith(...events: protocols.eventEntityAppear[]) {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        for (const e of events) mgr.onEvent(e);
        return mgr;
    }

    beforeEach(() => clearAllAliases());

    it('shows the alias instead of the real PC name', () => {
        const mgr = mgrWith(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
        setAlias('地域磨菇', '蘑菇雞');
        expect(prettyEntityName(mgr.entityMap[PC_ID], raceNameMap)).toBe('蘑菇雞');
    });

    it('falls back to the real name when no alias is set', () => {
        const mgr = mgrWith(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
        expect(prettyEntityName(mgr.entityMap[PC_ID], raceNameMap)).toBe('地域磨菇');
    });

    // A PC's GroupActor carries the same real name, so it must alias too —
    // otherwise the group header would still leak it.
    it('aliases the PC group header as well', () => {
        const mgr = mgrWith(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
        setAlias('地域磨菇', '蘑菇雞');
        expect(prettyEntityName(mgr.entityMap[PC_ID].group, raceNameMap)).toBe('蘑菇雞');
    });

    it('leaves monsters alone even if a same-named alias exists', () => {
        const mgr = mgrWith(appear({ Id: MOB_ID, RaceId: 20001, Name: MOB_ID }));
        setAlias(MOB_ID, '蘑菇雞');
        expect(prettyEntityName(mgr.entityMap[MOB_ID], raceNameMap)).toContain('灰狼');
    });

    it('leaves pets alone', () => {
        const mgr = mgrWith(
            appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }),
            appear({ Id: PET_ID, RaceId: 490359, OwnerId: PC_ID, Name: '小白' }),
        );
        setAlias('小白', '蘑菇雞');
        expect(prettyEntityName(mgr.entityMap[PET_ID], raceNameMap)).toBe('小白');
    });
});

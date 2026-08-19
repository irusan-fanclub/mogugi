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

describe('condition history', () => {
    function conditionEnable(
        ccId: number, at: number, Params: Record<string, string>,
    ): protocols.eventCharacterConditionEnable {
        return {
            EventId: 4, At: at, Id: PC_ID,
            CCId: ccId, DisableAt: at + 30, AttackerId: '', Params,
        };
    }

    function historyOf(...events: protocols.eventCharacterConditionEnable[]) {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
        for (const e of events) mgr.onEvent(e);
        return mgr.entityMap[PC_ID].conditionHistory;
    }

    // A bard re-buffing at a different magnitude is a new state: without an
    // entry the indicator would keep showing the first value forever.
    it('records a re-enable that carries a new magnitude', () => {
        const h = historyOf(
            conditionEnable(680, 100, { MCMBAMIN: '28.4', SBT: '1000' }),
            conditionEnable(680, 110, { MCMBAMIN: '32.8', SBT: '2000' }),
        );
        expect(h).toHaveLength(2);
        expect(h[1].List[0].Params.MCMBAMIN).toBe('32.8');
    });

    // SBT moves on every refresh; recording those would bury the real changes.
    it('does not record a refresh that only moves the timestamps', () => {
        const h = historyOf(
            conditionEnable(680, 100, { MCMBAMIN: '32.8', SBT: '1000' }),
            conditionEnable(680, 110, { MCMBAMIN: '32.8', SBT: '2000' }),
        );
        expect(h).toHaveLength(1);
    });

    it('still records a newly enabled condition', () => {
        const h = historyOf(
            conditionEnable(680, 100, { MCMBAMIN: '32.8' }),
            conditionEnable(516, 110, { SOP_DMG_MINMAX: '15' }),
        );
        expect(h).toHaveLength(2);
        expect(h[1].List.map(c => c.CCId)).toEqual([516, 680]);
    });

    // The bulk of a real log: an aura re-applying on a CC whose values nothing
    // reads. 388 has no entry in SIGNIFICANT_PARAM_KEYS, so no refresh of it
    // can ever be a new state.
    it('does not record a refresh of a CC whose values are never read', () => {
        const h = historyOf(
            conditionEnable(388, 100, { SBT: '1000' }),
            conditionEnable(388, 110, { SBT: '2000' }),
            conditionEnable(388, 120, { SBT: '3000' }),
        );
        expect(h).toHaveLength(1);
    });

    function conditionDisable(ccId: number, at: number): protocols.eventCharacterConditionDisable {
        return { EventId: 5, At: at, Id: PC_ID, CCId: ccId };
    }

    function historyOfMixed(
        ...events: (protocols.eventCharacterConditionEnable | protocols.eventCharacterConditionDisable)[]
    ) {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
        for (const e of events) mgr.onEvent(e);
        return mgr.entityMap[PC_ID].conditionHistory;
    }

    // The case that separates "is it on right now" from "have we seen it": a
    // CC coming back after a disable is a real state change, however many
    // times it has been enabled before.
    it('records a re-enable that follows a disable', () => {
        const h = historyOfMixed(
            conditionEnable(388, 100, { SBT: '1000' }),
            conditionDisable(388, 110),
            conditionEnable(388, 120, { SBT: '2000' }),
        );
        expect(h.map(s => s.At)).toEqual([100, 110, 120]);
        expect(h[2].List.map(c => c.CCId)).toEqual([388]);
    });

    it('ignores a disable for a condition that was not on', () => {
        const h = historyOfMixed(
            conditionEnable(388, 100, { SBT: '1000' }),
            conditionDisable(999, 110),
        );
        expect(h).toHaveLength(1);
    });
});

describe('bardsongEvents storage', () => {
    function bardsong(at: number, isEnd: boolean): protocols.eventBardsong {
        return {
            EventId: protocols.eventIdBardsong, At: at, Id: PC_ID,
            Performer: PC_ID, Song: '戰場上的狂吼', Bonuses: { 最大攻擊力: 35 }, IsEnd: isEnd,
        };
    }

    it('appends the raw event as-is', () => {
        const { mgr } = setup();
        const ev = bardsong(100, false);
        mgr.onEvent(ev);

        expect(mgr.bardsongEvents).toHaveLength(1);
        expect(mgr.bardsongEvents[0]).toEqual(ev);
    });

    // A stale performance must not survive into the next fight's chart, and
    // the shallowReactive array identity must survive clear() too — swapping
    // in a fresh array (e.g. `= []`) would silence every later push, since
    // the chart's computed is subscribed to this specific proxy (eventActor.ts:18-19).
    it('empties on clear() without replacing the shallowReactive array', () => {
        const { mgr } = setup();
        mgr.onEvent(bardsong(100, false));
        mgr.onEvent(bardsong(130, true));
        const arr = mgr.bardsongEvents;

        mgr.clear();

        expect(mgr.bardsongEvents).toBe(arr);
        expect(mgr.bardsongEvents).toHaveLength(0);
    });
});

describe('skill use ids storage', () => {
    function skillUse(id: string, skillId: number, at = 100): protocols.eventSkillUse {
        return { EventId: protocols.eventIdSkillUse, At: at, Id: id, SkillId: skillId };
    }

    it('records the skill id on the entity that used it, in order', () => {
        const { mgr } = setup();
        mgr.onEvent(skillUse(PC_ID, 59004));
        mgr.onEvent(skillUse(PC_ID, 59083));

        expect(mgr.entityMap[PC_ID].skillUses.map(u => u.SkillId)).toEqual([59004, 59083]);
    });

    // Matches the condition/equip event handlers: no placeholder is spun up,
    // the use is just dropped until the appear packet arrives.
    it('ignores a skill use from an entity that has not appeared yet', () => {
        const { mgr } = setup();
        mgr.onEvent(skillUse('4503599630099999', 59004));

        expect(mgr.entityMap['4503599630099999']).toBeUndefined();
    });

    it('empties on clear(), so a new fight starts without the old arcana signal', () => {
        const { mgr } = setup();
        mgr.onEvent(skillUse(PC_ID, 59004));

        mgr.clear();

        expect(mgr.entityMap[PC_ID].skillUses).toEqual([]);
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

describe('max life and appear time', () => {
    let mgr: ActorManager;
    beforeEach(() => { mgr = setup().mgr; });

    it('records appearAt from the first appear and keeps it on re-appear', () => {
        const mob = mgr.entityMap[MOB_ID];
        expect(mob.appearAt).toBe(1784805881);
        mgr.onEvent(appear({ Id: MOB_ID, RaceId: 4856, At: 1784809999 }));
        expect(mob.appearAt).toBe(1784805881);
    });

    it('stores maxLife from an eventMaxLife', () => {
        mgr.onEvent({ EventId: 20, At: 1784805890, Id: MOB_ID, MaxLife: 1967880064 } as protocols.eventMaxLife);
        expect(mgr.entityMap[MOB_ID].maxLife).toBe(1967880064);
    });

    it('creates a placeholder when max life precedes the appear', () => {
        mgr.onEvent({ EventId: 20, At: 1784805890, Id: FRESH_MOB_ID, MaxLife: 850368576 } as protocols.eventMaxLife);
        expect(mgr.entityMap[FRESH_MOB_ID]?.maxLife).toBe(850368576);
    });
});

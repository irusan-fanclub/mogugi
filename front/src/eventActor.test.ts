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

describe('casts', () => {
    function enable(ccId: number, at: number, disableAt: number, attackerId?: string) {
        return {
            EventId: 4, At: at, Id: PC_ID, CCId: ccId, DisableAt: disableAt,
            AttackerId: attackerId as string, Params: { SBT: String(disableAt * 1000) },
        } as protocols.eventCharacterConditionEnable;
    }
    function castsOf(...events: (protocols.eventCharacterConditionEnable | protocols.eventCharacterConditionDisable)[]) {
        const mgr = new ActorManager(new DamageCollectorManager());
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002, Name: '地域磨菇' }));
        for (const e of events) mgr.onEvent(e);
        return mgr.entityMap[PC_ID].casts;
    }

    it('counts repeated enables with the same end time once', () => {
        expect(castsOf(enable(1116, 1, 50), enable(1116, 2, 50), enable(1116, 3, 50))).toHaveLength(1);
    });
    it('counts an enable whose end time moved as a new cast', () => {
        expect(castsOf(enable(999, 1, 50), enable(999, 2, 80))).toHaveLength(2);
    });
    it('counts an enable after a disable as a new cast', () => {
        const c = castsOf(enable(999, 1, 50), { EventId: 5, At: 2, Id: PC_ID, CCId: 999 }, enable(999, 3, 50));
        expect(c).toHaveLength(2);
    });
    it('carries the attacker id, empty when absent', () => {
        const c = castsOf(enable(1, 1, 50, '77'), enable(2, 2, 50));
        expect(c).toEqual([
            { CCId: 1, At: 1, AttackerId: '77' },
            { CCId: 2, At: 2, AttackerId: '' },
        ]);
    });
});

describe('bardsongPulses storage', () => {
    const pulse: protocols.eventBardsongPulse = {
        EventId: protocols.eventIdBardsongPulse, At: 100, Id: '77', Targets: [PC_ID, '77'], Stop: false,
    };

    it('appends the raw pulse and empties it on clear() in place', () => {
        const { mgr } = setup();
        const arr = mgr.bardsongPulses;
        mgr.onEvent(pulse);
        expect(mgr.bardsongPulses).toEqual([pulse]);

        mgr.clear();
        expect(mgr.bardsongPulses).toHaveLength(0);
        expect(mgr.bardsongPulses).toBe(arr);
    });

    // The lane needs "me" to read the target lists; the id is identity, not
    // battle data, so a clear() between fights must not forget it.
    it('remembers the local player id from the owner-character event across clear()', () => {
        const { mgr } = setup();
        mgr.onEvent({ EventId: protocols.eventIdOwnerCharacter, At: 1, Id: PC_ID, Name: 'me' } as protocols.eventOwnerCharacter);
        expect(mgr.ownerEntityId).toBe(PC_ID);
        mgr.clear();
        expect(mgr.ownerEntityId).toBe(PC_ID);
    });

    // On connect the server sends the current owner (At = now) before the
    // history, so arrival order is not time order.
    it('keeps every owner change sorted by time, collapsing repeats', () => {
        const { mgr } = setup();
        const owner = (At: number, Id: string) => mgr.onEvent(
            { EventId: protocols.eventIdOwnerCharacter, At, Id, Name: Id } as protocols.eventOwnerCharacter);
        owner(900, 'b');
        owner(100, 'a');
        owner(500, 'b');
        owner(950, 'b');
        expect(mgr.ownerHistory).toEqual([{ At: 100, Id: 'a' }, { At: 500, Id: 'b' }]);
        expect(mgr.ownerEntityId).toBe('b');
        mgr.clear();
        expect(mgr.ownerHistory).toHaveLength(2);
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

    const life = (Id: string, At: number, Life: number) => ({ EventId: 26, At, Id, Life }) as protocols.eventEntityLife;

    it('EntityDown records downAt (earliest) on the entity', () => {
        const down = (At: number) => ({ EventId: 21, At, Id: MOB_ID }) as protocols.eventBase;
        expect(mgr.entityMap[MOB_ID]?.downAt ?? null).toBeNull();
        mgr.onEvent(down(120));
        mgr.onEvent(down(130));
        expect(mgr.entityMap[MOB_ID].downAt).toBe(120);
    });

    it('lifeAt: null is the latest, between samples the earlier, before the first undefined', () => {
        mgr.onEvent(life(MOB_ID, 100, 900));
        mgr.onEvent(life(MOB_ID, 110, 700));
        const mob = mgr.entityMap[MOB_ID];
        expect(mob.lifeAt(null)).toBe(700);
        expect(mob.lifeAt(105)).toBe(900);
        expect(mob.lifeAt(110)).toBe(700);
        expect(mob.lifeAt(99)).toBeUndefined();
    });

    it('inserts out-of-order life samples in At order', () => {
        mgr.onEvent(life(MOB_ID, 110, 700));
        mgr.onEvent(life(MOB_ID, 100, 900));
        expect(mgr.entityMap[MOB_ID].lifeHistory.map(s => s.At)).toEqual([100, 110]);
        expect(mgr.entityMap[MOB_ID].lifeAt(null)).toBe(700);
    });

    it('routes life to a placeholder when the appear is missing', () => {
        mgr.onEvent(life(FRESH_MOB_ID, 100, 500));
        expect(mgr.entityMap[FRESH_MOB_ID]?.lifeAt(null)).toBe(500);
    });

    const death = (Id: string, At: number, Dead: boolean) => ({ EventId: 27, At, Id, Dead }) as protocols.eventEntityDeath;

    it('remembers a finisher once set, and whether the log has killing-blow flags', () => {
        expect(mgr.hasFinishFlags).toBe(false);
        mgr.onEvent({ EventId: 6, At: 1, Id: MOB_ID, AttackerId: PC_ID } as protocols.eventFinish);
        mgr.onEvent({ EventId: 6, At: 2, Id: MOB_ID, AttackerId: '' } as protocols.eventFinish);
        expect(mgr.entityMap[MOB_ID].everFinished).toBe(true);
        mgr.onEvent({ ...damage(PC_ID, 1, 10), IsFinish: true } as protocols.eventDamage);
        expect(mgr.hasFinishFlags).toBe(true);
        mgr.clear();
        expect(mgr.hasFinishFlags).toBe(false);
    });

    it("佩塔克's first form counts as killed when the second form appears", () => {
        mgr.onEvent(appear({ Id: 'p1', RaceId: 7600, At: 1190 }));
        mgr.onEvent(appear({ Id: 'old', RaceId: 7600, At: 100 }));
        mgr.onEvent(appear({ Id: 'p2', RaceId: 7601, At: 1200 }));
        expect(mgr.entityMap.p1.killedAt).toBe(1200);
        expect(mgr.entityMap.old.killedAt).toBeNull();
        expect(mgr.entityMap.p2.killedAt).toBeNull();
    });

    it('a killing blow marks the target killed, a placeholder target included', () => {
        mgr.onEvent(damage(PC_ID, 1, 10));
        expect(mgr.entityMap[MOB_ID].killedAt).toBeNull();
        const finish = (target?: string): protocols.eventDamage => ({ ...damage(PC_ID, 1, 10, target), IsFinish: true });
        mgr.onEvent(finish());
        expect(mgr.entityMap[MOB_ID].killedAt).toBe(1784805900);
        mgr.onEvent(finish(FRESH_MOB_ID));
        expect(mgr.entityMap[FRESH_MOB_ID].killedAt).toBe(1784805900);
    });

    it('keeps death toggles in At order, a snapshot replay included', () => {
        mgr.onEvent(death(MOB_ID, 140, false));
        mgr.onEvent(death(MOB_ID, 120, true));
        expect(mgr.entityMap[MOB_ID].deathHistory).toEqual([{ At: 120, Dead: true }, { At: 140, Dead: false }]);
    });

    it("an older log's invincible flag becomes condition 91000", () => {
        const inv = (At: number, On: boolean) => ({ EventId: 28, At, Id: MOB_ID, On }) as protocols.eventEntityInvincible;
        mgr.onEvent(inv(110, true));
        mgr.onEvent(inv(160, false));
        const h = mgr.entityMap[MOB_ID].conditionHistory.filter(s => s.At >= 110);
        expect(h.map(s => [s.At, s.List.some(c => c.CCId === 91000)])).toEqual([[110, true], [160, false]]);
    });

    it('routes a death to a placeholder when the appear is missing', () => {
        mgr.onEvent(death(FRESH_MOB_ID, 100, true));
        expect(mgr.entityMap[FRESH_MOB_ID]?.deathHistory).toEqual([{ At: 100, Dead: true }]);
    });
});

describe('damage index', () => {
    it('replays prior damages to a late-appearing entity via the index', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        const A = '4503599630022001', C = '4503599630022002', B = '4767482418117001', D = '4767482418117002';
        mgr.onEvent(damage(A, 1, 100, B));
        mgr.onEvent(damage(C, 1, 50, B));
        mgr.onEvent(damage(A, 1, 7, D));
        // Placeholders never replay, and a non-PC appear wipes take-damage; use a PC and drop B's placeholder.
        delete mgr.entityMap[B];
        mgr.onEvent(appear({ Id: B, RaceId: 10002, Name: 'real' }));

        expect(mgr.entityMap[B].totalTakeDamage).toBe(150);
        expect(mgr.entityMap[B].takeDamages).toHaveLength(2);
    });

    it('entity appear cost does not grow with total damage count', () => {
        const dc = new DamageCollectorManager();
        const mgr = new ActorManager(dc);
        const A = '4503599630022001', B = '4767482418117001';
        for (let i = 0; i < 200_000; i++) mgr.onEvent(damage(A, 1, 1, B));

        const t0 = performance.now();
        for (let i = 0; i < 5_000; i++) {
            mgr.onEntityAppear(appear({ Id: `${4767482418200000 + i}`, RaceId: 4856 }));
        }
        expect(performance.now() - t0).toBeLessThan(300);
    });
});

describe('ActorManager.evictBefore', () => {
    const P1 = '4503599630022001';
    const P2 = '4503599630022002';
    const M1 = '4767482418117001';
    const M2 = '4767482418117002';
    const ap = (Id: string, RaceId: number, At: number, extra: Partial<protocols.eventEntityAppear> = {}) =>
        appear({ Id, RaceId, At, Name: `n:${Id}`, ...extra });
    const hit = (Id: string, At: number, Damage: number, TargetId: string): protocols.eventDamage =>
        ({ ...damage(Id, 1, Damage, TargetId), At });
    const battleA = [ap(M1, 4000, 100), ap(P1, 10002, 100), hit(P1, 110, 500, M1), hit(P1, 150, 700, M1), hit(M1, 160, 50, P1)];
    const battleB = [
        ap(M2, 4000, 1000), ap(P2, 10002, 1000),
        { EventId: 15, At: 1001, Id: P1 } as protocols.eventBase,
        hit(P1, 1010, 900, M2), hit(P2, 1020, 300, M2), hit(M2, 1030, 80, P1), hit(P1, 1100, 100, M2),
    ];
    const feedAll = (m: ActorManager, evs: protocols.eventBase[]) => evs.forEach(e => m.onEvent(e));
    const snap = (m: ActorManager, dc: DamageCollectorManager) => ({
        ents: Object.fromEntries(['P1', 'P2', 'M2'].map((k, i) => {
            const a = m.entityMap[[P1, P2, M2][i]];
            return [k, [a.totalApplyDamage, a.totalTakeDamage, a.applyDamages.length, a.takeDamages.length]];
        })),
        group: [m.groupMap['4000'].totalTakeDamage, m.groupMap['4000'].takeDamages.length],
        dc: dc.damages.map(d => [d.Id, d.TargetId, d.Damage]),
    });

    it('evictBefore leaves the kept battle identical to a fresh feed', () => {
        const dc1 = new DamageCollectorManager(), m1 = new ActorManager(dc1);
        const dc2 = new DamageCollectorManager(), m2 = new ActorManager(dc2);
        feedAll(m1, [...battleA, ...battleB]);
        m1.evictBefore(1000, [P1, P2, M2]);
        dc1.evictBefore(1000);
        feedAll(m2, battleB);
        // P1 only appeared in A: give the fresh manager the same entity.
        m2.onEvent(ap(P1, 10002, 100));
        expect(m1.damages).toEqual(m2.damages);
        expect(snap(m1, dc1).ents.P2).toEqual(snap(m2, dc2).ents.P2);
        expect(snap(m1, dc1).ents.M2).toEqual(snap(m2, dc2).ents.M2);
        expect(snap(m1, dc1).group).toEqual(snap(m2, dc2).group);
        expect(m1.entityMap[P1].totalApplyDamage).toBe(1000);
        expect(m1.entityMap[P1].applyDamages.length).toBe(2);
        expect(m1.entityMap[P1].totalTakeDamage).toBe(80);
        expect(snap(m1, dc1).dc).toEqual(snap(m2, dc2).dc);
        expect(m1.entityMap[M1]).toBeUndefined();
        expect(m1.groupMap['4000'].entityMap[M1]).toBeUndefined();
    });

    it('evictBefore keeps the owner', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [ap(P1, 10002, 100), { EventId: 14, At: 100, Id: P1, Name: 'me' } as protocols.eventBase, ...battleB]);
        mgr.evictBefore(1000);
        expect(mgr.ownerEntityId).toBe(P1);
        expect(mgr.entityMap[P1]).toBeDefined();
        expect(mgr.ownerHistory).toEqual([{ At: 1000, Id: P1 }]);
    });

    it('evictBefore keeps a quiet but present monster with its name and race', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [ap(M1, 4000, 100), ap(P1, 10002, 100), ...battleB]);
        mgr.evictBefore(2000, [M1, M2, P1, P2]);
        expect(mgr.entityMap[M1].raceId).toBe(4000);
        expect(mgr.entityMap[M1].name).toBe(`n:${M1}`);
        expect(mgr.groupMap['4000'].entityMap[M1]).toBeDefined();
        mgr.onEvent(hit(P1, 2100, 10, M1));
        expect(mgr.entityMap[M1].raceId).toBe(4000);
    });

    it('evictBefore drops a disappeared stranger, its pet and stale monster', () => {
        const PET = '4503599630022101';
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [ap(P1, 10002, 100), ap(PET, 5000, 100, { OwnerId: P2 }), ...battleA, ...battleB]);
        mgr.evictBefore(2000, [P1]);
        expect(mgr.entityMap[P1]).toBeDefined();
        expect(mgr.entityMap[P2]).toBeUndefined();
        expect(mgr.entityMap[PET]).toBeUndefined();
        expect(mgr.entityMap[M1]).toBeUndefined();
        expect(mgr.groupMap['4000']).toBeUndefined();
    });

    it('evictBefore keeps an owner and entities with events after the cut even when not present', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [ap(P1, 10002, 100), { EventId: 14, At: 100, Id: P1, Name: 'me' } as protocols.eventBase, ...battleB]);
        mgr.evictBefore(1050, []);
        expect(mgr.entityMap[P1]).toBeDefined();
        expect(mgr.entityMap[M2]).toBeDefined(); // hit at 1100
        expect(mgr.entityMap[P2]).toBeUndefined(); // last hit 1020
    });

    it('evictBefore without a present list drops no entity', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [...battleA, ...battleB]);
        mgr.evictBefore(2000);
        expect(Object.keys(mgr.entityMap).sort()).toEqual([M1, M2, P1, P2].sort());
    });

    it('evictBefore keeps state seeds', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [...battleA, ...battleB]);
        mgr.onEvent({ EventId: 27, At: 120, Id: M2, Dead: true } as protocols.eventBase);
        mgr.onEvent({ EventId: 4, At: 130, Id: M2, CCId: 9, DisableAt: 5000, AttackerId: P1, Params: {} } as protocols.eventBase);
        mgr.evictBefore(1000);
        const m2 = mgr.entityMap[M2];
        expect(m2.deathHistory).toEqual([{ At: 1000, Dead: true }]);
        expect(m2.conditionHistory.map(s => [s.At, s.List.length])).toEqual([[1000, 1]]);
        expect(m2.casts.length).toBe(0);
    });

    it('evictBefore drops bard-song events and per-entity skill uses before the cut', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        feedAll(mgr, [...battleA, ...battleB]);
        mgr.onEvent({ EventId: 17, At: 120, Id: P1, SkillId: 5 } as protocols.eventBase);
        mgr.onEvent({ EventId: 17, At: 1200, Id: P1, SkillId: 6 } as protocols.eventBase);
        mgr.onEvent({ EventId: 16, At: 120, Id: P1 } as protocols.eventBase);
        mgr.evictBefore(1000);
        expect(mgr.entityMap[P1].skillUses.map(s => s.SkillId)).toEqual([6]);
        expect(mgr.bardsongEvents.length).toBe(0);
    });
    it('keeps the look fields from the appear event and leaves them undefined for old events', () => {
        const mgr = new ActorManager(new DamageCollectorManager());
        mgr.onEvent(appear({ Id: PC_ID, RaceId: 10002, SkinColor: 45, EyeType: 207, EyeColor: 192, LeftEyeColor: 190, RightEyeColor: 191, MouthType: 80 }));
        const b = mgr.entityMap[PC_ID].body;
        expect([b.SkinColor, b.EyeType, b.EyeColor, b.LeftEyeColor, b.RightEyeColor, b.MouthType]).toEqual([45, 207, 192, 190, 191, 80]);
        // Body updates must not wipe the look fields.
        mgr.onEvent({ EventId: 9, At: 2, Id: PC_ID, Height: 1.1, Weight: 1, Upper: 1, Lower: 1 } as protocols.eventBase);
        expect(mgr.entityMap[PC_ID].body.SkinColor).toBe(45);

        mgr.onEvent(appear({ Id: PET_ID, RaceId: 10002 }));
        const old = mgr.entityMap[PET_ID].body;
        expect([old.SkinColor, old.EyeType, old.EyeColor, old.LeftEyeColor, old.RightEyeColor, old.MouthType]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    });
});

describe('clock shift', () => {
    const enable = (CCId: number, DisableAt: number, At = 1000): protocols.eventCharacterConditionEnable =>
        ({ EventId: 4, At, Id: PC_ID, CCId, DisableAt, AttackerId: '', Params: {} });
    const shift = (ShiftSec: number, At = 1100, Gen = 1): protocols.eventClockShift =>
        ({ EventId: 29, At, Id: '', ShiftSec, Gen });
    const NO_EXPIRY = 9223372036854775.807;

    it('moves active conditions, skipping no-expiry, no-limit and ended ones', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(1, 1200));
        mgr.onEvent(enable(2, 0));
        mgr.onEvent(enable(3, NO_EXPIRY));
        mgr.onEvent(enable(4, 1050));
        mgr.onEvent(shift(-3));
        const m = mgr.entityMap[PC_ID].conditionMap;
        expect(m[1].DisableAt).toBe(1197);
        expect(m[2].DisableAt).toBe(0);
        expect(m[3].DisableAt).toBe(NO_EXPIRY);
        expect(m[4].DisableAt).toBe(1050);
    });

    it('reaches every actor and does not record a cast', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(1, 1200));
        const castsBefore = mgr.entityMap[PC_ID].casts.length;
        const historyBefore = mgr.entityMap[PC_ID].conditionHistory.length;
        mgr.onEvent({ ...enable(1, 1300), Id: MOB_ID });
        mgr.onEvent(shift(2.5));
        expect(mgr.entityMap[MOB_ID].conditionMap[1].DisableAt).toBe(1302.5);
        expect(mgr.entityMap[PC_ID].casts).toHaveLength(castsBefore);
        expect(mgr.entityMap[PC_ID].conditionHistory).toHaveLength(historyBefore);
    });

    it('leaves the recorded history untouched', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(1, 1200));
        mgr.onEvent(shift(-3));
        const last = mgr.entityMap[PC_ID].conditionHistory.at(-1)!;
        expect(last.List.find(c => c.CCId === 1)!.DisableAt).toBe(1200);
    });
});

describe('clock shift generations', () => {
    const enable = (CCId: number, DisableAt: number, extra: Partial<protocols.eventCharacterConditionEnable> = {}): protocols.eventCharacterConditionEnable =>
        ({ EventId: 4, At: 1000, Id: PC_ID, CCId, DisableAt, AttackerId: '', Params: {}, ...extra });
    const shift = (ShiftSec: number, Gen: number, At = 1100): protocols.eventClockShift =>
        ({ EventId: 29, At, Id: '', ShiftSec, Gen });

    it('a late-attach snapshot at the current generation ignores older shifts', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(1, 1200, { ClockGen: 2 }));
        mgr.onEvent(shift(-3, 1));
        mgr.onEvent(shift(-1, 2));
        expect(mgr.entityMap[PC_ID].conditionMap[1].DisableAt).toBe(1200);
        mgr.onEvent(shift(-0.5, 3));
        expect(mgr.entityMap[PC_ID].conditionMap[1].DisableAt).toBe(1199.5);
    });

    it('a condition without ClockGen counts as generation 0 and is moved by each new generation once', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(1, 1200));
        mgr.onEvent(shift(-3, 1));
        mgr.onEvent(shift(-3, 1));
        expect(mgr.entityMap[PC_ID].conditionMap[1].DisableAt).toBe(1197);
        mgr.onEvent(shift(1, 2));
        expect(mgr.entityMap[PC_ID].conditionMap[1].DisableAt).toBe(1198);
    });

    it('never moves a local-clock condition', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(900206, 1200, { LocalClock: true }));
        mgr.onEvent(shift(-3, 1));
        expect(mgr.entityMap[PC_ID].conditionMap[900206].DisableAt).toBe(1200);
    });

    it('moves a condition that only looks ended because the clock was off', () => {
        const { mgr } = setup();
        mgr.onEvent(enable(1, 1090));
        mgr.onEvent(shift(20, 1, 1100));
        expect(mgr.entityMap[PC_ID].conditionMap[1].DisableAt).toBe(1110);
    });
});

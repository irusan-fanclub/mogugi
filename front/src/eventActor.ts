import { CustomReactive, IUpdateCallback, scheduleTrigger } from '@/lib/util';
import { shallowReactive } from 'vue';
import * as bounds from 'binary-search-bounds';

import * as protocols from '@/protocols';
import { DamageCollectorManager } from '@/actionCollector';
import { conditionStateChanged, significantValuesChanged } from '@/lib/conditionChange';
import { isCast, type CastRecord } from '@/lib/castDetect';
import type { OwnerChange } from '@/lib/bardsongTrack';
import { BOSS_INVINCIBLE_CC_ID, type DeathToggle } from '@/lib/activeDps';
import { BOSS_PREV_FORM, FORM_CHANGE_WINDOW_SEC } from '@/lib/bossRaces';

// TODO: take cc, apply cc 구분하기

// The Go side sends a far-future sentinel (~9.2e15 s) for conditions that never expire.
const NO_EXPIRY_SEC = 1e12;

export class ActorManager {
    constructor(private _damageCollector: DamageCollectorManager) {
    }

    public entityMap: Record<string, EntityActor> = shallowReactive({});
    public groupMap: Record<string, GroupActor> = shallowReactive({});
    public damages: protocols.eventDamage[] = [];
    // Each raw hit under its attacker and its target, in arrival order, so a
    // new entity replays only its own hits. Raw events are never re-owned
    // (reattribute edits the collector's copies), so the keys stay valid.
    private damagesByEntity = new Map<string, protocols.eventDamage[]>();
    // shallowReactive so a push() here is what invalidates computeds that
    // read it — there is no per-entity owner to route this through.
    public bardsongEvents: protocols.eventBardsong[] = shallowReactive([]);
    public bardsongPulses: protocols.eventBardsongPulse[] = shallowReactive([]);
    // The local player's entity id, needed to read "me" out of pulse target
    // lists. Identity rather than battle data, so clear() keeps it.
    private _owner = shallowReactive({ id: '' });
    public get ownerEntityId() { return this._owner.id; }
    // Every owner change sorted by At, for the bard-song lane: a session can
    // switch characters, and older fights must keep the owner they had.
    public ownerHistory: OwnerChange[] = shallowReactive([]);

    public static pcRaceSet = new Set<number>([8001, 8002, 9001, 9002, 10001, 10002]);

    // Some hit carried the killing-blow flag, so this log has it; older logs need the finisher fallback.
    public hasFinishFlags = false;

    /** A boss's next form appearing counts its just-seen earlier form as killed. */
    private endPreviousForm(raceId: number, at: number) {
        const prev = BOSS_PREV_FORM[raceId];
        if (prev === undefined) return;
        for (const a of Object.values(this.entityMap)) {
            if (a.raceId === prev && a.killedAt === null && at - a.lastEventAt <= FORM_CHANGE_WINDOW_SEC) a.onKilled(at);
        }
    }

    public onEvent(event: protocols.eventBase) {
        if (event.EventId === protocols.eventIdEntityAppear) {
            this.onEntityAppear(event as protocols.eventEntityAppear);
        }

        const entity = this.entityMap[event.Id];
        if (entity) entity.touch(event.At);

        switch (event.EventId) {
            case protocols.eventIdEntityAppear: {
                // TODO: entityAppear에서 master id, hp 가져오기, damage, cc 처리할 때 master id가 있으면 그쪽으로 보내야함
                const prevOwnerId = entity.ownerId;
                entity.onEntityAppear(event as protocols.eventEntityAppear);

                // A pet/summon that hit before its appear packet was collected
                // under its own id (owner unknown then); now the owner is known,
                // move that damage onto the owner. A summon (人偶) counts as the
                // owner's own output, a real pet is tagged as pet damage.
                if (entity.ownerId && entity.ownerId !== prevOwnerId) {
                    const petId = ActorManager.isSummonRace(entity.raceId) ? '' : entity.id;
                    this._damageCollector.reattribute(entity.id, entity.ownerId, petId);
                }
                this.endPreviousForm(entity.raceId, event.At);
                break;
            }

            case protocols.eventIdDamage:
                {
                    const event_ = event as protocols.eventDamage;

                    // 유저 정보가 오기전에 대미지가 먼저오는 경우
                    // @TODO: 추후에 local storage를 사용해 캐싱하는 식으로 변경
                    //
                    // Both stand-ins must exist before the hit is processed:
                    // onApplyDamage bails out on an unknown target, and a new
                    // entity's replay only restores the take-damage side, so
                    // the hit would otherwise be lost. They're also created
                    // before the event is recorded, or that replay would count
                    // this very hit a second time.
                    const attacker = entity ?? this.addPlaceholderEntity(event_.Id, event_.At);
                    const target = this.entityMap[event_.TargetId]
                        ?? this.addPlaceholderEntity(event_.TargetId, event_.At);
                    target.touch(event_.At);

                    this.damages.push(event_);
                    this.indexDamage(event_.Id, event_);
                    if (event_.TargetId !== event_.Id) this.indexDamage(event_.TargetId, event_);

                    attacker.onApplyDamage(event_);
                    attacker.group.onApplyDamage(event_);

                    target.onTakeDamage(event_);
                    target.group.onTakeDamage(event_);
                    if (event_.IsFinish) {
                        target.onKilled(event_.At);
                        this.hasFinishFlags = true;
                    }
                }
                break;

            case protocols.eventIdMaxLife:
                // A placeholder keeps the value when the appear packet is
                // late (or never comes on a mid-fight attach).
                (entity ?? this.addPlaceholderEntity(event.Id, event.At))
                    .onMaxLife(event as protocols.eventMaxLife);
                break;

            case protocols.eventIdEntityLife:
                (entity ?? this.addPlaceholderEntity(event.Id, event.At))
                    .onLife(event as protocols.eventEntityLife);
                break;

            case protocols.eventIdEntityDown:
                (entity ?? this.addPlaceholderEntity(event.Id, event.At))
                    .onDown(event);
                break;

            case protocols.eventIdEntityDeath:
                (entity ?? this.addPlaceholderEntity(event.Id, event.At))
                    .onDeath(event as protocols.eventEntityDeath);
                break;

            case protocols.eventIdEntityInvincible:
                (entity ?? this.addPlaceholderEntity(event.Id, event.At))
                    .onInvincible(event as protocols.eventEntityInvincible);
                break;

            case protocols.eventIdCharacterConditionEnable:
                if (!entity) {
                    return;
                }

                entity.onCharacterConditionEnable(event as protocols.eventCharacterConditionEnable);
                break;

            case protocols.eventIdCharacterConditionDisable:
                if (!entity) {
                    return;
                }

                entity.onCharacterConditionDisable(event as protocols.eventCharacterConditionDisable);
                break;

            case protocols.eventIdFinish:
                if (!entity) {
                    return;
                }

                entity.onFinish(event as protocols.eventFinish);
                break;

            case protocols.eventIdEntityEquipItem:
                if (!entity) {
                    return;
                }

                entity.onEquipItem(event as protocols.eventEntityEquipItem);
                break;

            case protocols.eventIdEntityUnequipItem:
                if (!entity) {
                    return;
                }

                entity.onUnequipItem(event as protocols.eventEntityUnequipItem);
                break;

            case protocols.eventIdEntityUpdateBody:
                if (!entity) {
                    return;
                }

                entity.onUpdateBody(event as protocols.eventEntityUpdateBody);
                break;

            case protocols.eventIdSkillUse:
                if (!entity) {
                    return;
                }

                entity.onSkillUse(event as protocols.eventSkillUse);
                break;

            // Party-wide, not per-entity — the chart's bard-song lane is
            // built from these lists directly (see lib/bardsongTrack.ts).
            case protocols.eventIdBardsong:
                this.bardsongEvents.push(event as protocols.eventBardsong);
                break;

            case protocols.eventIdClockShift:
                for (const a of Object.values(this.entityMap)) a.onClockShift(event as protocols.eventClockShift);
                break;

            case protocols.eventIdBardsongPulse:
                this.bardsongPulses.push(event as protocols.eventBardsongPulse);
                break;

            case protocols.eventIdOwnerCharacter:
                this._owner.id = event.Id;
                this.addOwnerChange({ At: event.At, Id: event.Id });
                break;
        }
    }

    private indexDamage(id: string, d: protocols.eventDamage) {
        const list = this.damagesByEntity.get(id);
        if (list) list.push(d);
        else this.damagesByEntity.set(id, [d]);
    }

    // A repeat of the owner already in force at that time adds nothing; one
    // that precedes the same owner's later entry moves that entry earlier.
    private addOwnerChange(c: OwnerChange) {
        const h = this.ownerHistory;
        let i = h.findIndex(o => o.At > c.At);
        if (i < 0) i = h.length;
        if (i > 0 && h[i - 1].Id === c.Id) return;
        if (h[i]?.Id === c.Id) h[i] = c;
        else h.splice(i, 0, c);
    }

    /**
     * Stands in for an entity whose appear packet hasn't been seen — it may
     * still be on its way, or mogugi may have started after the entity was
     * already there, in which case it never comes at all. A later appear
     * overwrites the name and race.
     */
    private addPlaceholderEntity(id: string, at: number): EntityActor {
        this.onEntityAppear({
            Id: id,
            EventId: 1,
            At: at,
            Name: `unknown:${id}`,
            // Guessing wrong here would either hide a player from the damage
            // tables or list a monster as one, so go by the id class rather
            // than assuming.
            RaceId: ActorManager.isPlayerId(id) ? 10001 : ActorManager.unknownRaceId,
            Height: 1,
            Weight: 1,
            Upper: 1,
            Lower: 1,
            GuildName: "",
            OwnerId: "",
        });

        this.entityMap[id].touch(at);
        return this.entityMap[id];
    }

    /** Marionette / golem / other summoned-unit race block (990xxx). Their
     *  damage counts as the owner's own output, not pet damage. */
    public static isSummonRace(raceId: number): boolean {
        return raceId >= 990000 && raceId < 991000;
    }

    /** Race of a placeholder whose real race isn't known yet. */
    public static readonly unknownRaceId = 0;

    /**
     * Entity ids carry their kind in the top bits: 0x1000 is the player
     * block, 0x1001 pets/partners/summons, 0x10f0 monsters and NPCs.
     * Verified against 33,961 appear packets — the 0x1000 block holds the six
     * player races and nothing else.
     */
    private static isPlayerId(id: string): boolean {
        const v = Number(id);
        return Number.isFinite(v) && Math.floor(v / 0x10000000000) === 0x1000;
    }

    /** Player (0x1000) or pet/partner/summon (0x1001) id: our side, never a monster. */
    public static isAllyId(id: string): boolean {
        const v = Number(id);
        const block = Math.floor(v / 0x10000000000);
        return Number.isFinite(v) && (block === 0x1000 || block === 0x1001);
    }

    public onEntityAppear(event: protocols.eventEntityAppear) {
        const { Id, RaceId, Name } = event;

        const groupKey = ActorManager.groupTargetKey(event);
        const group = this.groupMap[groupKey] ??= CustomReactive(new GroupActor(this, groupKey, RaceId, Name));

        let entity = this.entityMap[Id];
        const isNewEntity = !entity;
        const dummyEntity = entity?.name.startsWith('unknown:');

        if (isNewEntity || dummyEntity) {
            if (isNewEntity) {
                entity = CustomReactive(new EntityActor(this, Id, RaceId, Name, group));
                this.entityMap[Id] = group.entityMap[Id] = entity;

                // Replay historical damages only for truly new entities
                // (e.g. when dilmeter started after the entity appeared).
                // Dummy entities already received damages in real-time,
                // so replaying would duplicate them.
                for (const v of this.damagesByEntity.get(Id) ?? []) {
                    if (v.Id == Id) {
                        entity.onApplyDamage(v);
                        entity.group.onApplyDamage(v);
                    }
                    else if (v.TargetId == Id) {
                        entity.onTakeDamage(v);
                        entity.group.onTakeDamage(v);
                        if (v.IsFinish) entity.onKilled(v.At);
                    }
                }
            }
        }
    }

    public onEntityDamage(event: EntityDamage) {
        this._damageCollector.onDamage(event);
    }

    public forceUpdateAll(): void {
        for (const k in this.entityMap) {
            this.entityMap[k].forceUpdate();
        }
        for (const k in this.groupMap) {
            this.groupMap[k].forceUpdate();
        }
    }

    /**
     * Drops everything older than `t` (unix seconds) so what remains equals a
     * fresh feed of the events at or after `t`. State histories keep their last
     * entry before `t` as the starting state, clamped to `t` so no span reads
     * back into evicted time. `present` lists the entity ids the backend still
     * holds; absent, quiet entities are deleted only when not listed.
     */
    public evictBefore(t: number, present?: Iterable<string>): void {
        const keep = <T extends { At: number }>(a: T[]) => dropBefore(a, t);
        keep(this.damages);
        for (const [k, list] of this.damagesByEntity) {
            if (keep(list).length === 0) this.damagesByEntity.delete(k);
        }
        keep(this.bardsongEvents);
        keep(this.bardsongPulses);
        seedBefore(this.ownerHistory, t);

        const ownerIds = new Set([this._owner.id, ...this.ownerHistory.map(o => o.Id)]);
        // Presence is decided by the backend entityCache; without a list (old
        // replays) nothing is dropped, only trimmed.
        const live = present ? new Set(present) : undefined;
        for (const k of Object.keys(this.entityMap)) {
            const e = this.entityMap[k];
            if (live && e.lastEventAt < t && !ownerIds.has(k) && !live.has(k)) {
                delete e.group.entityMap[k];
                delete this.entityMap[k];
            } else {
                e.evictBefore(t);
            }
        }
        for (const k of Object.keys(this.groupMap)) {
            const g = this.groupMap[k];
            if (Object.keys(g.entityMap).length === 0) delete this.groupMap[k];
            else g.evictBefore(t);
        }
        this.forceUpdateAll();
    }

    public clear() {
        // object instance를 새로 만들면 귀찮아짐
        this.hasFinishFlags = false;
        this.damages.length = 0;
        this.damagesByEntity.clear();
        this.bardsongEvents.length = 0;
        this.bardsongPulses.length = 0;

        for (const k in this.entityMap) {
            const v = this.entityMap[k];

            v.clear();
        }

        for (const k in this.groupMap) {
            const v = this.groupMap[k];

            v.clear();
        }
    }

    private static groupTargetKey(event: protocols.eventEntityAppear): string {
        // pc 일 경우 group안에 entity가 여러개 생기지 않도록
        // Placeholders group per entity too — their race is a stand-in, so
        // grouping by it would pile every unidentified monster into one row.
        if (this.pcRaceSet.has(event.RaceId) || event.RaceId === this.unknownRaceId) {
            return event.Id;
        }

        return `${event.RaceId}`;
    }
}

interface IEventActor {
    /** damage 쪽 수치들만 reset */
    clear(): void;
}

export abstract class BaseActor implements IEventActor, IUpdateCallback {
    protected vueUpdateTrack?: () => void;
    private vueUpdateTrigger?: () => void;
    // Stable identity so the shared scheduler's Set dedupes repeat requests.
    private readonly fireTrigger = () => this.vueUpdateTrigger?.();

    protected constructor(protected mgr: ActorManager, private _id: string, protected _raceId: number, protected _name: string) {
    }

    public get id() {
        this.vueUpdateTrack?.();
        return this._id;
    }

    public get raceId() {
        this.vueUpdateTrack?.();
        return this._raceId;
    }

    public get name() {
        this.vueUpdateTrack?.();
        return this._name;
    }

    protected _body: EntityBody = {
        Height: 1,
        Weight: 1,
        Upper: 1,
        Lower: 1,
    };
    public get body() {
        this.vueUpdateTrack?.();
        return this._body;
    }

    /** 받은 대미지 */
    public get totalTakeDamage() {
        this.vueUpdateTrack?.();
        return this._totalTakeDamage;
    }
    protected _totalTakeDamage = 0;

    protected _takeDamages: EntityDamage[] = [];
    public get takeDamages() {
        this.vueUpdateTrack?.();
        return this._takeDamages;
    }

    /** 준 대미지 */
    public get totalApplyDamage() {
        this.vueUpdateTrack?.();
        return this._totalApplyDamage;
    }
    protected _totalApplyDamage = 0;

    protected _applyDamages: EntityDamage[] = [];
    public get applyDamages() {
        this.vueUpdateTrack?.();
        return this._applyDamages;
    }

    /** Derived, not cached: a placeholder starts out as a character and only
     *  learns its real race when the appear packet lands. */
    public get isPC() {
        this.vueUpdateTrack?.();
        return ActorManager.pcRaceSet.has(this._raceId);
    }

    public onEntityAppear(_event: protocols.eventEntityAppear): void {
        // nothing
    }

    public onTakeDamage(_event: protocols.eventDamage): void {
        // nothing
    }

    public onApplyDamage(_event: protocols.eventDamage): void {
        // nothing
    }

    public onCharacterConditionEnable(_event: protocols.eventCharacterConditionEnable): void {
        // nothing
    }

    public onCharacterConditionDisable(_event: protocols.eventCharacterConditionDisable): void {
        // nothing
    }

    public onClockShift(_event: protocols.eventClockShift): void {
        // nothing
    }

    public onFinish(_event: protocols.eventFinish): void {
        // nothing
    }

    public onSkillUse(_event: protocols.eventSkillUse): void {
        // nothing
    }

    public onEquipItem(_event: protocols.eventEntityEquipItem): void {
        // nothing
    }

    public onUnequipItem(_event: protocols.eventEntityUnequipItem): void {
        // nothing
    }

    public onUpdateBody(event: protocols.eventEntityUpdateBody): void {
        this._body.Height = event.Height;
        this._body.Weight = event.Weight;
        this._body.Upper = event.Upper;
        this._body.Lower = event.Lower;

        this.vueUpdateRequest();
    }

    /** Drops damage before `t` and recomputes the totals. */
    public evictBefore(t: number): void {
        dropBefore(this._takeDamages, t);
        dropBefore(this._applyDamages, t);
        this._totalTakeDamage = this._takeDamages.reduce((n, d) => n + d.Damage, 0);
        this._totalApplyDamage = this._applyDamages.reduce((n, d) => n + d.Damage, 0);
    }

    public clear() {
        this._totalTakeDamage = 0;
        this._takeDamages.length = 0;

        this._totalApplyDamage = 0;
        this._applyDamages.length = 0;

        this.vueUpdateRequest();
    }

    public setUpdateCallback(track: () => void, trigger: () => void): void {
        this.vueUpdateTrack = track;
        this.vueUpdateTrigger = trigger;
    }

    protected vueUpdateRequest(): void {
        scheduleTrigger(this.fireTrigger);
    }

    public forceUpdate(): void {
        // A duplicate fire from a still-pending scheduled entry is harmless.
        this.fireTrigger();
    }
}

export class EntityActor extends BaseActor {
    public constructor(mgr: ActorManager, id: string, raceId: number, name: string, private _group: GroupActor) {
        super(mgr, id, raceId, name);
    }

    protected _guildName = '';
    public get guildName() {
        this.vueUpdateTrack?.();
        return this._guildName;
    }

    protected _ownerId = '';
    public get ownerId() {
        this.vueUpdateTrack?.();
        return this._ownerId;
    }

    // Latest event touching this entity; evictBefore removes the long-quiet ones.
    public lastEventAt = 0;
    public touch(at: number) {
        if (at > this.lastEventAt) this.lastEventAt = at;
    }

    protected _appearAt?: number;
    public get appearAt() {
        this.vueUpdateTrack?.();
        return this._appearAt;
    }

    protected _maxLife?: number;
    public get maxLife() {
        this.vueUpdateTrack?.();
        return this._maxLife;
    }

    public onMaxLife(event: protocols.eventMaxLife): void {
        this.vueUpdateRequest();
        this._maxLife = event.MaxLife;
    }

    protected _lifeHistory: { At: number; Life: number }[] = [];
    public get lifeHistory() {
        this.vueUpdateTrack?.();
        return this._lifeHistory;
    }

    /** Insert in At order (stable for equal At); snapshot and replay may interleave. */
    public onLife(event: protocols.eventEntityLife): void {
        this.vueUpdateRequest();
        const h = this._lifeHistory;
        let i = h.length;
        while (i > 0 && h[i - 1].At > event.At) i--;
        h.splice(i, 0, { At: event.At, Life: event.Life });
    }

    protected _downAt: number | null = null;
    /** Time of the one-shot boss kill (EntityDown); records carry it instead of life samples. */
    public get downAt(): number | null {
        this.vueUpdateTrack?.();
        return this._downAt;
    }

    public onDown(event: protocols.eventBase): void {
        this.vueUpdateRequest();
        if (this._downAt === null || event.At < this._downAt) this._downAt = event.At;
    }

    protected _killedAt: number | null = null;
    /** Time of the latest killing blow taken (hit option 0x1000). */
    public get killedAt(): number | null {
        this.vueUpdateTrack?.();
        return this._killedAt;
    }

    public onKilled(at: number): void {
        this.vueUpdateRequest();
        this._killedAt = at;
    }

    protected _deathHistory: DeathToggle[] = [];
    public get deathHistory() {
        this.vueUpdateTrack?.();
        return this._deathHistory;
    }

    /** Insert in At order (stable for equal At), like onLife. */
    public onDeath(event: protocols.eventEntityDeath): void {
        this.vueUpdateRequest();
        const h = this._deathHistory;
        let i = h.length;
        while (i > 0 && h[i - 1].At > event.At) i--;
        h.splice(i, 0, { At: event.At, Dead: event.Dead });
    }

    /** Older logs carry the 0x7533 flag as its own event; it is condition 91000 now. */
    public onInvincible(event: protocols.eventEntityInvincible): void {
        const base = { At: event.At, Id: event.Id, CCId: BOSS_INVINCIBLE_CC_ID };
        if (event.On) this.onCharacterConditionEnable({ ...base, EventId: 4, DisableAt: 0, AttackerId: '', Params: {} });
        else this.onCharacterConditionDisable({ ...base, EventId: 5 });
    }

    /** Life at `at` (last sample with At <= at); null = latest. */
    public lifeAt(at: number | null): number | undefined {
        const h = this.lifeHistory;
        if (at === null) return h.length ? h[h.length - 1].Life : undefined;
        let lo = 0, hi = h.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (h[mid].At <= at) lo = mid + 1; else hi = mid;
        }
        return lo ? h[lo - 1].Life : undefined;
    }

    public get group() {
        this.vueUpdateTrack?.();
        return this._group;
    }

    protected _conditionMap: Record<number, EntityCondition> = {};
    public get conditionMap() {
        this.vueUpdateTrack?.();
        return this._conditionMap;
    }

    protected _conditionHistory: EntityConditionState[] = [];
    public get conditionHistory() {
        this.vueUpdateTrack?.();
        return this._conditionHistory;
    }

    // Real condition applications, in arrival order. Follows conditionHistory's
    // lifetime, so clear() does not reset it.
    protected _casts: CastRecord[] = [];
    public get casts() {
        this.vueUpdateTrack?.();
        return this._casts;
    }

    private _finisherId = '';
    public get finisherId() {
        this.vueUpdateTrack?.();
        return this._finisherId;
    }

    // A finisher was set at least once; the kill fallback for logs without the killing-blow flag.
    private _everFinished = false;
    public get everFinished() {
        this.vueUpdateTrack?.();
        return this._everFinished;
    }

    // Skills this character has used, in order — the only signal arcana
    // (秘法) can be derived from. See lib/arcana.ts.
    protected _skillUses: protocols.eventSkillUse[] = [];
    public get skillUses() {
        this.vueUpdateTrack?.();
        return this._skillUses;
    }

    protected _equipItemMap: Record<number, EntityItem> = {};
    public get equipItemMap() {
        this.vueUpdateTrack?.();
        return this._equipItemMap;
    }

    public override onEntityAppear(event: protocols.eventEntityAppear): void {
        this.vueUpdateRequest();

        // First-seen time; later re-appears (region re-entry, dummy
        // upgrade) must not shift it.
        this._appearAt ??= event.At;
        this._name = event.Name;
        this._raceId = event.RaceId;
        this._finisherId = '';
        this._guildName = event.GuildName;
        // Keep a previously-learned owner if a later appear omits it (a summon's
        // first appears sometimes lack the owner before it is fully spawned).
        this._ownerId = event.OwnerId || this._ownerId;
        this._body.Height = event.Height;
        this._body.Weight = event.Weight;
        this._body.Upper = event.Upper;
        this._body.Lower = event.Lower;
        this._body.SkinColor = event.SkinColor;
        this._body.EyeType = event.EyeType;
        this._body.EyeColor = event.EyeColor;
        this._body.LeftEyeColor = event.LeftEyeColor;
        this._body.RightEyeColor = event.RightEyeColor;
        this._body.MouthType = event.MouthType;

        if (ActorManager.pcRaceSet.has(event.RaceId)) {
            // pc일 경우 damage 초기와 안함
            return;
        }

        this._totalTakeDamage = 0;
        this._takeDamages.length = 0;
    }

    public override onTakeDamage(event: protocols.eventDamage): void {
        this.vueUpdateRequest();

        const attacker = this.mgr.entityMap[event.Id];

        const damage: EntityDamage = {
            ...event,

            Conditions: attacker?.getConditionState(event.At) ?? [],
            TargetConditions: this.getConditionState(event.At),
            PetId: '',
        }

        this._totalTakeDamage += event.Damage;
        this._takeDamages.push(damage);
    }

    public override onApplyDamage(event: protocols.eventDamage): void {
        this.vueUpdateRequest();

        const attackerId = event.Id;
        const attacker = this.mgr.entityMap[attackerId];
        
        const targetId = event.TargetId;
        const target = this.mgr.entityMap[targetId];
        if (!target || !(target instanceof EntityActor)) {
            // 몹 정보가 없으면 무시
            return;
        }

        const damage: EntityDamage = {
            ...event,

            Conditions: this.getConditionState(event.At),
            TargetConditions: target.getConditionState(event.At),
            PetId: '',
        }

        // apply의 경우 pet 대신 pc가 공격한 것 처럼 처리
        // Redirect an owned unit's damage onto its owner. A summon (人偶) is the
        // owner's own output, so leave it untagged; a real pet is tagged so the
        // pet-free views can drop it.
        if (attacker?.ownerId) {
            damage.Id = attacker.ownerId;
            if (!ActorManager.isSummonRace(attacker.raceId)) {
                damage.PetId = attackerId;
            }
        }

        this._totalApplyDamage += event.Damage;
        this._applyDamages.push(damage);

        // apply에서만 호출
        this.mgr.onEntityDamage(damage);
    }

    public override onCharacterConditionEnable(event: protocols.eventCharacterConditionEnable): void {
        this.vueUpdateRequest();

        const wasOn = this._conditionMap[event.CCId];
        const now = {
            Id: event.Id,
            At: event.At,
            CCId: event.CCId,
            DisableAt: event.DisableAt,
            AttackerId: event.AttackerId,
            Params: event.Params ?? {},
            ...(event.ClockGen ? { ClockGen: event.ClockGen } : {}),
            ...(event.LocalClock ? { LocalClock: true } : {}),
        };
        this._conditionMap[event.CCId] = now;

        // Must precede the early return below: unchanged re-enables are
        // exactly the ones that are not casts, but a new DisableAt is.
        if (isCast(wasOn, now)) {
            this._casts.push({ CCId: event.CCId, At: event.At, AttackerId: event.AttackerId ?? '' });
        }

        // Re-enabling a CC that is already on, at the same magnitudes, cannot
        // change the state — and that is nearly all of these events: one
        // 50-minute log had 75,243 enables, 72,040 of them repeats and only
        // 161 on a CC whose values are read at all. Deciding it from this one
        // condition avoids rebuilding and sorting the whole active set.
        if (wasOn && !significantValuesChanged(wasOn, now)) {
            return;
        }

        const prev = this._conditionHistory.length ? this._conditionHistory[this._conditionHistory.length - 1].List : [];
        const current = Object.values(this._conditionMap).sort((a, b) => a.CCId - b.CCId);

        if (conditionStateChanged(prev, current)) {
            this._conditionHistory.push({
                At: event.At,
                List: current,
            });
        }
    }

    public override onCharacterConditionDisable(event: protocols.eventCharacterConditionDisable): void {
        this.vueUpdateRequest();

        // Removing a CC that was not on changes nothing, so there is no set to
        // rebuild — the same shortcut the enable path takes.
        if (this._conditionMap[event.CCId] === undefined) {
            return;
        }
        delete this._conditionMap[event.CCId];

        const prev = this._conditionHistory.length ? this._conditionHistory[this._conditionHistory.length - 1].List : [];
        const current = Object.values(this._conditionMap).sort((a, b) => a.CCId - b.CCId);

        if (conditionStateChanged(prev, current)) {
            this._conditionHistory.push({
                At: event.At,
                List: current,
            });
        }
    }

    public override onClockShift(event: protocols.eventClockShift): void {
        this.vueUpdateRequest();

        // Copies, not edits: conditionHistory shares the objects and records what was true then.
        for (const [id, c] of Object.entries(this._conditionMap)) {
            if (c.DisableAt === 0 || c.DisableAt >= NO_EXPIRY_SEC || c.LocalClock) continue;
            if ((c.ClockGen ?? 0) >= event.Gen) continue;
            const moved = c.DisableAt + event.ShiftSec;
            if (c.DisableAt <= event.At && moved <= event.At) continue;
            this._conditionMap[Number(id)] = {
                ...c, DisableAt: moved, ClockGen: event.Gen, Shifted: (c.Shifted ?? 0) + event.ShiftSec,
            };
        }
    }

    public override onFinish(event: protocols.eventFinish): void {
        this.vueUpdateRequest();

        this._finisherId = event.AttackerId;
        if (event.AttackerId) this._everFinished = true;
    }

    public override onSkillUse(event: protocols.eventSkillUse): void {
        this.vueUpdateRequest();

        // The whole event, not just the id: the cast-count column filters
        // casts by the same time range the damage columns already obey.
        this._skillUses.push(event);
    }

    public override onEquipItem(event: protocols.eventEntityEquipItem): void {
        this.vueUpdateRequest();

        this._equipItemMap[event.PocketType] = event;
    }

    public override onUnequipItem(event: protocols.eventEntityUnequipItem): void {
        this.vueUpdateRequest();

        delete this._equipItemMap[event.PocketType];
    }

    public getConditionState(at: number): EntityCondition[] {
        const idx = bounds.le<{ At: number }>(this._conditionHistory, { At: at }, (a, b) => a.At - b.At);
        if (idx < 0) {
            return [];
        }

        return this._conditionHistory[idx].List;
    }

    public override evictBefore(t: number): void {
        super.evictBefore(t);
        dropBefore(this._casts, t);
        dropBefore(this._skillUses, t);
        seedBefore(this._lifeHistory, t);
        seedBefore(this._deathHistory, t);
        seedBefore(this._conditionHistory, t);
    }

    public override clear() {
        super.clear();

        this._skillUses.length = 0;
    }
}

// TODO: GroupActor에 Group 조건 추가하는 식으로 바꾸는게 좋을듯
export class GroupActor extends BaseActor {
    public constructor(mgr: ActorManager, id: string, raceId: number, name: string) {
        const groupName = ActorManager.pcRaceSet.has(raceId)
            ? name : `${raceId}`;

        super(mgr, id, raceId, groupName);
    }

    private _entityMap: Record<string, EntityActor> = {};
    public get entityMap() {
        this.vueUpdateTrack?.();
        return this._entityMap;
    }

    public override onEntityAppear(event: protocols.eventEntityAppear): void {
        this.vueUpdateRequest();

        this._name = ActorManager.pcRaceSet.has(event.RaceId)
            ? event.Name : `${event.RaceId}`;
        this._raceId = event.RaceId;

        if (ActorManager.pcRaceSet.has(event.RaceId)) {
            // pc일 경우 damage 초기와 안함
            return;
        }

        const target = this._entityMap[event.Id];
        if (!target) {
            // ?
            return;
        }

        this._takeDamages = this._takeDamages.filter(v => v.Id !== event.Id);
        this._totalTakeDamage = this._takeDamages.reduce((acc, v) => acc + v.Damage, 0);
    }

    public override onTakeDamage(event: protocols.eventDamage): void {
        this.vueUpdateRequest();
        // console.log('group take damage', this.id, event);

        const attacker = this.mgr.entityMap[event.Id];
        const target = this._entityMap[event.TargetId];
        if (!target) {
            // ?
            return;
        }

        const damage: EntityDamage = {
            ...event,

            Conditions: attacker?.getConditionState(event.At) ?? [],
            TargetConditions: target.getConditionState(event.At),
            PetId: '',
        }

        this._totalTakeDamage += event.Damage;
        this._takeDamages.push(damage);
    }

    public override clear(): void {
        super.clear();
    }
}

/** Removes entries older than `t` in place and returns the array. */
function dropBefore<T extends { At: number }>(a: T[], t: number): T[] {
    let n = 0;
    for (const v of a) if (v.At >= t) a[n++] = v;
    a.length = n;
    return a;
}

/** Keeps entries from `t` on plus the latest earlier one, re-stamped to `t` as the starting state. */
function seedBefore<T extends { At: number }>(a: T[], t: number): void {
    let seed: T | undefined;
    for (const v of a) if (v.At < t) seed = v;
    dropBefore(a, t);
    if (seed && !(a.length && a[0].At === t)) a.unshift({ ...seed, At: t });
}

export type EntityDamage = {
    Id: string;
    At: number;
    TargetId: string;
    SkillId: number;
    Damage: number;
    IsCritical: boolean;
    IsDelayed: boolean;
    Conditions: EntityCondition[];
    TargetConditions: EntityCondition[];
    PetId: string; // 펫 공격일 경우
};

export type EntityCondition = {
    Id: string;
    At: number;
    CCId: number;
    DisableAt: number;
    AttackerId: string;
    Params: Record<string, string>;
    ClockGen?: number;
    LocalClock?: boolean;
    /** Total clock shift applied to DisableAt; DisableAt - Shifted is the expiry as first received. */
    Shifted?: number;
}

export type EntityConditionState = {
    At: number;
    List: EntityCondition[];
}

export type EntityItem = {
    PocketType: number;
    ItemId: number;
    Color1: string;
    Color2: string;
    Color3: string;
    Color5: string;
    Color6: string;
    Color7: string;
}

export type EntityBody = {
    Height: number;
    Weight: number;
    Upper: number;
    Lower: number;
    // Look fields from the appear event; undefined when not published.
    SkinColor?: number;
    EyeType?: number;
    EyeColor?: number;
    LeftEyeColor?: number;
    RightEyeColor?: number;
    MouthType?: number;
}
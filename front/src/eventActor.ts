import { CustomReactive, IUpdateCallback } from '@/util';
import { shallowReactive } from 'vue';
import * as bounds from 'binary-search-bounds';

import * as protocols from '@/protocols';
import { DamageCollectorManager } from '@/actionCollector';

// TODO: Distinguish between take cc and apply cc

export class ActorManager {
    constructor(private _damageCollector: DamageCollectorManager) {
    }

    public entityMap: Record<string, EntityActor> = shallowReactive({});
    public groupMap: Record<string, GroupActor> = shallowReactive({});
    public damages: protocols.eventDamage[] = [];

    public static pcRaceSet = new Set<number>([8001, 8002, 9001, 9002, 10001, 10002]);

    public onEvent(event: protocols.eventBase) {
        if (event.EventId === protocols.eventIdEntityAppear) {
            this.onEntityAppear(event as protocols.eventEntityAppear);
        }

        const entity = this.entityMap[event.Id];

        switch (event.EventId) {
            case protocols.eventIdEntityAppear:
                // TODO: Get master id, hp from entityAppear, when processing damage/cc, should send to master id if it exists
                entity.onEntityAppear(event as protocols.eventEntityAppear);
                break;

            case protocols.eventIdDamage:
                {
                    const event_ = event as protocols.eventDamage;
                    this.damages.push(event_);

                    if (entity) {
                        entity.onApplyDamage(event_);
                        entity.group.onApplyDamage(event_);
                    }

                    const targetEntity = this.entityMap[event_.TargetId];
                    if (!targetEntity) {
                        // Case where damage arrives before user info
                        // @TODO: Change to use local storage for caching later
                        this.onEntityAppear({
                            Id: event_.TargetId,
                            EventId: 1,
                            At: Date.now() / 1000,
                            Name: `unknown:${event_.TargetId}`,
                            RaceId: 10001,
                            Height: 1,
                            Weight: 1,
                            Upper: 1,
                            Lower: 1,
                            GuildName: "",
                            OwnerId: "",
                        })
                    }

                    targetEntity.onTakeDamage(event_);
                    targetEntity.group.onTakeDamage(event_);
                }
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
        }
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
            }

            // Case where API is turned on after receiving entity appear
            for (const v of this.damages) {
                if (v.Id == Id) {
                    entity.onApplyDamage(v);
                    entity.group.onApplyDamage(v);
                }
                else if (v.TargetId == Id) {
                    entity.onTakeDamage(v);
                    entity.group.onTakeDamage(v);
                }
            }
        }
    }

    public onEntityDamage(event: EntityDamage) {
        this._damageCollector.onDamage(event);
    }

    public clear() {
        // Creating new object instances would be troublesome
        this.damages.length = 0;

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
        // For PC, prevent multiple entities in a group
        if (this.pcRaceSet.has(event.RaceId)) {
            return event.Id;
        }

        return `${event.RaceId}`;
    }
}

interface IEventActor {
    /** Reset only damage-related values */
    clear(): void;
}

export abstract class BaseActor implements IEventActor, IUpdateCallback {
    protected vueUpdateTrack?: () => void;
    private vueUpdateTrigger?: () => void;
    private vueUpdateTimeout = 0;
    private static vueUpdateTick = 33;

    protected constructor(protected mgr: ActorManager, private _id: string, protected _raceId: number, protected _name: string) {
        this._isPC = ActorManager.pcRaceSet.has(_raceId);
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

    /** Damage received */
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

    /** Damage dealt */
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

    private _isPC = false;
    public get isPC() {
        this.vueUpdateTrack?.();
        return this._isPC;
    }

    public onEntityAppear(event: protocols.eventEntityAppear): void {
        // nothing
        event;
    }

    public onTakeDamage(event: protocols.eventDamage): void {
        // nothing
        event;
    }

    public onApplyDamage(event: protocols.eventDamage): void {
        // nothing
        event;
    }

    public onCharacterConditionEnable(event: protocols.eventCharacterConditionEnable): void {
        // nothing
        event;
    }

    public onCharacterConditionDisable(event: protocols.eventCharacterConditionDisable): void {
        // nothing
        event;
    }

    public onFinish(event: protocols.eventFinish): void {
        // nothing
        event;
    }

    public onEquipItem(event: protocols.eventEntityEquipItem): void {
        // nothing
        event;
    }

    public onUnequipItem(event: protocols.eventEntityUnequipItem): void {
        // nothing
        event;
    }

    public onUpdateBody(event: protocols.eventEntityUpdateBody): void {
        this._body.Height = event.Height;
        this._body.Weight = event.Weight;
        this._body.Upper = event.Upper;
        this._body.Lower = event.Lower;

        this.vueUpdateRequest();
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

    private vueUpdate(): void {
        this.vueUpdateTimeout = 0;
        this.vueUpdateTrigger?.();
    }

    protected vueUpdateRequest(): void {
        if (this.vueUpdateTimeout) {
            return;
        }

        this.vueUpdateTimeout = setTimeout(() => this.vueUpdate(), BaseActor.vueUpdateTick);
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

    private _finisherId = '';
    public get finisherId() {
        this.vueUpdateTrack?.();
        return this._finisherId;
    }

    protected _equipItemMap: Record<number, EntityItem> = {};
    public get equipItemMap() {
        this.vueUpdateTrack?.();
        return this._equipItemMap;
    }

    public override onEntityAppear(event: protocols.eventEntityAppear): void {
        this.vueUpdateRequest();

        this._name = event.Name;
        this._raceId = event.RaceId;
        this._finisherId = '';
        this._guildName = event.GuildName;
        this._ownerId = event.OwnerId;
        this._body.Height = event.Height;
        this._body.Weight = event.Weight;
        this._body.Upper = event.Upper;
        this._body.Lower = event.Lower;

        if (ActorManager.pcRaceSet.has(event.RaceId)) {
            // Don't initialize damage for PC
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
        }

        this._totalTakeDamage += event.Damage;
        this._takeDamages.push(damage);
    }

    public override onApplyDamage(event: protocols.eventDamage): void {
        this.vueUpdateRequest();

        const targetId = event.TargetId;
        const target = this.mgr.entityMap[targetId];
        if (!target || !(target instanceof EntityActor)) {
            // Ignore if mob info doesn't exist
            return;
        }

        const damage: EntityDamage = {
            ...event,

            Conditions: this.getConditionState(event.At),
            TargetConditions: target.getConditionState(event.At),
        }

        this._totalApplyDamage += event.Damage;
        this._applyDamages.push(damage);

        // Only called in apply
        this.mgr.onEntityDamage(damage);
    }

    public override onCharacterConditionEnable(event: protocols.eventCharacterConditionEnable): void {
        this.vueUpdateRequest();

        this._conditionMap[event.CCId] = {
            Id: event.Id,
            At: event.At,
            CCId: event.CCId,
            DisableAt: event.DisableAt,
            AttackerId: event.AttackerId,
        };

        const prev = this._conditionHistory.length ? this._conditionHistory[this._conditionHistory.length - 1].List : [];
        const current = Object.values(this._conditionMap).sort((a, b) => a.CCId - b.CCId);

        const needUpdate = prev.length !== current.length || !prev.every((v, i) => v.CCId === current[i].CCId);
        if (needUpdate) {
            this._conditionHistory.push({
                At: event.At,
                List: current,
            });
        }
    }

    public override onCharacterConditionDisable(event: protocols.eventCharacterConditionDisable): void {
        this.vueUpdateRequest();

        delete this._conditionMap[event.CCId];

        const prev = this._conditionHistory.length ? this._conditionHistory[this._conditionHistory.length - 1].List : [];
        const current = Object.values(this._conditionMap).sort((a, b) => a.CCId - b.CCId);

        const needUpdate = prev.length !== current.length || !prev.every((v, i) => v.CCId === current[i].CCId);
        if (needUpdate) {
            this._conditionHistory.push({
                At: event.At,
                List: current,
            });
        }
    }

    public override onFinish(event: protocols.eventFinish): void {
        this.vueUpdateRequest();

        this._finisherId = event.AttackerId;
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

    public override clear() {
        super.clear();
    }
}

// TODO: It would be better to change to adding Group conditions to GroupActor
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
            // Don't initialize damage for PC
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
        }

        this._totalTakeDamage += event.Damage;
        this._takeDamages.push(damage);
    }

    public override clear(): void {
        super.clear();
    }
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
};

export type EntityCondition = {
    Id: string;
    At: number;
    CCId: number;
    DisableAt: number;
    AttackerId: string;
}

type EntityConditionState = {
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
}
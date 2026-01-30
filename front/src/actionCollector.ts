import { CustomReactive, IUpdateCallback } from '@/util';
import { EntityDamage } from '@/eventActor';

// TODO: Add cc
export class DamageCollectorManager {
    public get damages() {
        return this._damages;
    }
    private _damages = [] as EntityDamage[];

    // Check performance to decide whether to split by entity id
    private _et = new DamageEventTarget("Damage", "DamageCollector");

    public onDamage(p: EntityDamage): void {
        this._damages.push(p);
        this._et.dispatchEvent(new CustomEvent("Damage", { detail: p }));
    }

    public getFilteredDamageCollector(filter: DamageCollectorFilter): FilteredDamageCollector {
        const v = new FilteredDamageCollector(filter);
        for (const p of this._damages) {
            v.handleDamage(p);
        }

        // It would be better to chain et -> filtered et -> filtered et
        this._et.addEventListener("Damage", v);
        this._et.addEventListener("Clear", v);

        return CustomReactive(v);
    }

    public getGroupedDamageCollector(filter: DamageCollectorFilter, getGroupKey: DamageCollectorGroupKey): GroupedDamageCollector {
        const v = new GroupedDamageCollector(filter, getGroupKey);
        for (const p of this._damages) {
            v.handleDamage(p);
        }

        this._et.addEventListener("Damage", v);
        this._et.addEventListener("Clear", v);

        return CustomReactive(v);
    }

    public getDualGroupedDamageCollector(filter: DamageCollectorFilter, getGroupKey1: DamageCollectorGroupKey, getGroupKey2: DamageCollectorGroupKey): DualGroupedDamageCollector {
        const v = new DualGroupedDamageCollector(filter, getGroupKey1, getGroupKey2);
        for (const p of this._damages) {
            v.handleDamage(p);
        }

        this._et.addEventListener("Damage", v);
        this._et.addEventListener("Clear", v);

        return CustomReactive(v);
    }

    public removeDamageCollector(collector: DamageCollectorBase): void {
        this._et.removeEventListener("Damage", collector);
        this._et.removeEventListener("Clear", collector);
    }

    public clear(): void {
        this._damages = [];
        this._et.dispatchEvent(new CustomEvent("Clear"));
    }
}

export abstract class DamageCollectorBase implements DamageEventListenerObject, IUpdateCallback {
    private static objectIdSeq = 1;
    private _objectId = DamageCollectorBase.objectIdSeq++;
    public get objectId(): number {
        return this._objectId;
    }

    protected vueUpdateTrack?: () => void;
    private vueUpdateTrigger?: () => void;
    private vueUpdateTimeout = 0;
    private static vueUpdateTick = 33;

    public constructor(private _filter: DamageCollectorFilter) {
    }

    public handleEvent(e: CustomEvent<EntityDamage>): void {
        switch (e.type) {
            case "Damage":
                this.handleDamage(e.detail);
                break;

            case "Clear":
                this.handleClear();
                break;
        }
    }

    public handleDamage(p: EntityDamage): void {
        if (!this._filter(p)) {
            return;
        }

        this.onDamage(p);

        if (!this.vueUpdateTimeout) {
            this.vueUpdateTimeout = setTimeout(() => {
                this.vueUpdate();
            }, DamageCollectorBase.vueUpdateTick);
        }
    }

    public handleClear(): void {
        this.onClear();

        if (!this.vueUpdateTimeout) {
            this.vueUpdateTimeout = setTimeout(() => {
                this.vueUpdate();
            }, DamageCollectorBase.vueUpdateTick);
        }
    }

    protected abstract onDamage(p: EntityDamage): void;

    protected abstract onClear(): void;

    public setUpdateCallback(track: () => void, trigger: () => void): void {
        this.vueUpdateTrack = track;
        this.vueUpdateTrigger = trigger;
    }

    private vueUpdate(): void {
        this.vueUpdateTimeout = 0;
        this.vueUpdateTrigger?.();
    }
}

export class FilteredDamageCollector extends DamageCollectorBase {
    public constructor(filter: DamageCollectorFilter) {
        super(filter);
    }

    public get damages() {
        this.vueUpdateTrack?.();
        return this._damages;
    }
    private _damages = [] as EntityDamage[];

    public get totalDamage() {
        this.vueUpdateTrack?.();
        return this._totalDamage;
    }
    private _totalDamage = 0;

    private _minDamage = 0;
    public get minDamage() {
        this.vueUpdateTrack?.();
        return this._minDamage;
    }

    private _maxDamage = 0;
    public get maxDamage() {
        this.vueUpdateTrack?.();
        return this._maxDamage;
    }

    private _count = 0;
    public get count() {
        this.vueUpdateTrack?.();
        return this._count;
    }

    protected override onDamage(p: EntityDamage): void {
        this._damages.push(p);
        this._totalDamage += p.Damage;

        if (p.IsDelayed && !needCountSkill[p.SkillId]) {
            return;
        }

        this._count++;

        if (this._minDamage === 0 || p.Damage < this._minDamage) {
            this._minDamage = p.Damage;
        }

        if (p.Damage > this._maxDamage) {
            this._maxDamage = p.Damage;
        }
    }

    protected override onClear(): void {
        this._damages.length = 0;
        this._totalDamage = 0;
        this._minDamage = 0;
        this._maxDamage = 0;
        this._count = 0;
    }
}

export class GroupedDamageCollector extends FilteredDamageCollector {
    public constructor(filter: DamageCollectorFilter, protected _getGroupKey: DamageCollectorGroupKey) {
        super(filter);
    }

    private _groupedDamages: Record<string, EntityDamage[]> = {};
    public get groupedDamages() {
        this.vueUpdateTrack?.();
        return this._groupedDamages;
    }

    private _groupedTotalDamages: Record<string, number> = {};
    public get groupedTotalDamages() {
        this.vueUpdateTrack?.();
        return this._groupedTotalDamages;
    }

    private _groupedMinDamages: Record<string, number> = {};
    public get groupedMinDamages() {
        this.vueUpdateTrack?.();
        return this._groupedMinDamages;
    }

    private _groupedMaxDamages: Record<string, number> = {};
    public get groupedMaxDamages() {
        this.vueUpdateTrack?.();
        return this._groupedMaxDamages;
    }

    private _groupedCount: Record<string, number> = {};
    public get groupedCount() {
        this.vueUpdateTrack?.();
        return this._groupedCount;
    }

    protected override onDamage(p: EntityDamage): void {
        super.onDamage(p);

        const key = this._getGroupKey(p);
        if (!this._groupedDamages[key]) {
            this._groupedDamages[key] = [];
            this._groupedTotalDamages[key] = 0;
            this._groupedCount[key] = 0;
        }

        this._groupedDamages[key].push(p);
        this._groupedTotalDamages[key] += p.Damage;

        if (p.IsDelayed && !needCountSkill[p.SkillId]) {
            return;
        }

        this._groupedCount[key]++;

        if (!this._groupedMinDamages[key] || p.Damage < this._groupedMinDamages[key]) {
            this._groupedMinDamages[key] = p.Damage;
        }

        if (p.Damage > (this._groupedMaxDamages[key] ?? 0)) {
            this._groupedMaxDamages[key] = p.Damage;
        }
    }

    protected override onClear(): void {
        super.onClear();

        for (const k in this._groupedDamages) {
            delete this._groupedDamages[k];
        }

        for (const k in this._groupedTotalDamages) {
            delete this._groupedTotalDamages[k];
        }

        for (const k in this._groupedCount) {
            delete this._groupedCount[k];
        }

        for (const k in this._groupedMinDamages) {
            delete this._groupedMinDamages[k];
        }

        for (const k in this._groupedMaxDamages) {
            delete this._groupedMaxDamages[k];
        }
    }
}

export class DualGroupedDamageCollector extends GroupedDamageCollector {
    public constructor(filter: DamageCollectorFilter, getGroupKey1: DamageCollectorGroupKey, private _getGroupKey2: DamageCollectorGroupKey) {
        super(filter, getGroupKey1);
    }

    private _grouped2Damages: Record<string, EntityDamage[]> = {};
    public get grouped2Damages() {
        this.vueUpdateTrack?.();
        return this._grouped2Damages;
    }

    private _grouped2TotalDamages: Record<string, number> = {};
    public get grouped2TotalDamages() {
        this.vueUpdateTrack?.();
        return this._grouped2TotalDamages;
    }

    private _grouped2MinDamages: Record<string, number> = {};
    public get grouped2MinDamages() {
        this.vueUpdateTrack?.();
        return this._grouped2MinDamages;
    }

    private _grouped2MaxDamages: Record<string, number> = {};
    public get grouped2MaxDamages() {
        this.vueUpdateTrack?.();
        return this._grouped2MaxDamages;
    }

    private _grouped2Count: Record<string, number> = {};
    public get grouped2Count() {
        this.vueUpdateTrack?.();
        return this._grouped2Count;
    }

    private _dualGroupedDamages: Record<string, Record<string, EntityDamage[]>> = {};
    public get dualGroupedDamages() {
        this.vueUpdateTrack?.();
        return this._dualGroupedDamages;
    }

    private _dualGroupedTotalDamages: Record<string, Record<string, number>> = {};
    public get dualGroupedTotalDamages() {
        this.vueUpdateTrack?.();
        return this._dualGroupedTotalDamages;
    }

    private _dualGroupedMinDamages: Record<string, Record<string, number>> = {};
    public get dualGroupedMinDamages() {
        this.vueUpdateTrack?.();
        return this._dualGroupedMinDamages;
    }

    private _dualGroupedMaxDamages: Record<string, Record<string, number>> = {};
    public get dualGroupedMaxDamages() {
        this.vueUpdateTrack?.();
        return this._dualGroupedMaxDamages;
    }

    private _dualGroupedCount: Record<string, Record<string, number>> = {};
    public get dualGroupedCount() {
        this.vueUpdateTrack?.();
        return this._dualGroupedCount;
    }

    protected override onDamage(p: EntityDamage) {
        super.onDamage(p);

        const key1 = this._getGroupKey(p);
        const key2 = this._getGroupKey2(p);

        if (!this._grouped2Damages[key2]) {
            this._grouped2Damages[key2] = [];
            this._grouped2TotalDamages[key2] = 0;
            this._grouped2Count[key2] = 0;
        }

        this._grouped2Damages[key2].push(p);
        this._grouped2TotalDamages[key2] += p.Damage;

        if (!this._dualGroupedDamages[key1]) {
            this._dualGroupedDamages[key1] = {};
            this._dualGroupedTotalDamages[key1] = {};
            this._dualGroupedMinDamages[key1] = {};
            this._dualGroupedMaxDamages[key1] = {};
            this._dualGroupedCount[key1] = {};
        }

        if (!this._dualGroupedDamages[key1][key2]) {
            this._dualGroupedDamages[key1][key2] = [];
            this._dualGroupedTotalDamages[key1][key2] = 0;
            this._dualGroupedCount[key1][key2] = 0;
        }

        this._dualGroupedDamages[key1][key2].push(p);
        this._dualGroupedTotalDamages[key1][key2] += p.Damage;
        
        if (p.IsDelayed && !needCountSkill[p.SkillId]) {
            return;
        }

        this._grouped2Count[key2]++;
        this._dualGroupedCount[key1][key2]++;

        if (!this._grouped2MinDamages[key2] || p.Damage < this._grouped2MinDamages[key2]) {
            this._grouped2MinDamages[key2] = p.Damage;
        }

        if (p.Damage > (this._grouped2MaxDamages[key2] ?? 0)) {
            this._grouped2MaxDamages[key2] = p.Damage;
        }

        if (!this._dualGroupedMinDamages[key1][key2] || p.Damage < this._dualGroupedMinDamages[key1][key2]) {
            this._dualGroupedMinDamages[key1][key2] = p.Damage;
        }

        if (p.Damage > (this._dualGroupedMaxDamages[key1][key2] ?? 0)) {
            this._dualGroupedMaxDamages[key1][key2] = p.Damage;
        }
    }

    protected override onClear() {
        super.onClear();

        for (const k in this._grouped2Damages) {
            delete this._grouped2Damages[k];
        }

        for (const k in this._grouped2TotalDamages) {
            delete this._grouped2TotalDamages[k];
        }

        for (const k in this._dualGroupedDamages) {
            delete this._dualGroupedDamages[k];
        }

        for (const k in this._dualGroupedTotalDamages) {
            delete this._dualGroupedTotalDamages[k];
        }
    }
}

/*
export class DamageCollectorFilter {
    public get filter() {
        return this._filter;
    }

    public constructor(private _filter: (p: EntityDamage) => boolean) {
    }

    public check(p: EntityDamage) {
        return this._filter(p);
    }
}
*/

type DamageCollectorFilter = (p: EntityDamage) => boolean;
type DamageCollectorGroupKey = (p: EntityDamage) => string;

// type DamageEventType = "TakeDamage" | "ApplyDamage";
type DamageEventType = "Damage" | "Clear";

interface IDamageEventTarget extends EventTarget {
    addEventListener(type: DamageEventType, callback: DamageEventListenerObject, options?: boolean | AddEventListenerOptions): void
    removeEventListener(type: DamageEventType, callback: DamageEventListenerObject, options?: boolean | EventListenerOptions): void;
}

/*
interface DamageEventListener extends EventListener {
    (evt: CustomEvent<EntityDamage>): void;
}
*/

interface DamageEventListenerObject extends EventListenerObject {
    objectId: number;
    handleEvent(evt: CustomEvent<EntityDamage>): void;
}

class DamageEventTarget extends EventTarget implements IDamageEventTarget {
    public get type() {
        return this._type;
    }

    public get id() {
        return this._id;
    }

    public constructor(private _type: DamageEventType, private _id: string) {
        super();
    }

    public get count() {
        return this._count;
    }
    private _count = 0;

    private cbSet: Record<string, Set<number>> = {};

    public override addEventListener(type: DamageEventType, listener: DamageEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        if (this.cbSet[type]?.has(listener.objectId)) {
            return;
        }

        if (!this.cbSet[type]) {
            this.cbSet[type] = new Set();
        }

        this.cbSet[type].add(listener.objectId);
        super.addEventListener(type, listener, options);
        this._count++;
    }

    public override removeEventListener(type: DamageEventType, listener: DamageEventListenerObject, options?: boolean | EventListenerOptions): void {
        if (!this.cbSet[type]?.has(listener.objectId)) {
            return;
        }

        if (!this.cbSet[type]) {
            // ?
            return;
        }

        this.cbSet[type].delete(listener.objectId);
        super.removeEventListener(type, listener, options);
        this._count--;
    }
}

export const needCountSkill: Record<number, boolean> = {
    58009: true, // Continuous Attack
    58100: true, // Blast
    58101: true, // Flare
}
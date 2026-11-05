import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { DamageCollectorBase, DualGroupedDamageCollector, GroupedDamageCollector } from '@/actionCollector';
import type { EntityActor } from '@/eventActor';
import { createBackendSession } from '@/lib/backendSession';
import { createAlertTracker, type AlertFire, type AlertStep } from '@/lib/alertRules';
import { buildPlayerRows } from '@/lib/battleStats';
import { emitDesktop, onDesktopEvent } from '@/lib/desktopBridge';
import { createArcanaTracker } from '@/lib/arcana';
import { ARCANA_BY_SKILL } from '@/lib/arcanaTable';
import { activeCondition, buildDpsOverlay, resolveOverlayTarget, type DpsOverlayVM } from '@/lib/overlayModel';
import { layoutOf } from '@/lib/overlayComponents';
import { isOverlayState, OV, type OverlayState } from '@/lib/overlayProtocol';
import { loadOverlaySettings, normalizeOverlaySettings, type AlertRule, type OverlaySettings } from '@/lib/overlaySettings';
import { CC_SECTION_IDS, type CcSectionId, type SectionId } from '@/lib/overlaySections';
import { buildCcTiles, buildCooldownTiles, type Holder, type TileVM } from '@/lib/overlayTiles';
import { wsUrl } from '@/lib/runtimeEnv';
import { createCooldownTracker } from '@/lib/skillCooldown';
import { isKilled, titleBoss } from '@/lib/targets';
import { warcryConditions, withConditions } from '@/lib/warcryLive';
import { gaugeNow, TUAIRIM_GAIN_CC, type Gauge } from '@/lib/tuairim';
import { ccName, prettyEntityName, stripRaceSuffix } from '@/lib/util';
import { actorManager, condNameMap, dcManager, isBossRace, raceNameMap, tuairim } from '@/store';
import { createSpeechQueue } from './speechQueue';

const TICK_MS = 250;
const DPS_EVERY = 2;

export interface OverlayData {
    settings: Ref<OverlaySettings>;
    state: Ref<OverlayState | null>;
    dps: Ref<DpsOverlayVM>;
    /** Per section: tiles by item key, settings order, shown items only. */
    tiles: Ref<SectionTiles>;
    /** A boss is present and not down. */
    bossAlive: Ref<boolean>;
    /** A boss is present, alive or dead. */
    bossPresent: Ref<boolean>;
    inDungeon: Ref<boolean>;
    alerts: Ref<AlertItem[]>;
    /** The backend replays a file: the overlay shows and tracks nothing. */
    replaying: Readonly<Ref<boolean>>;
}

export type SectionTiles = Record<SectionId, Map<string, TileVM[]>>;

export const emptyTiles = (): SectionTiles => ({
    ccBoss: new Map(), ccSelf: new Map(), ccParty: new Map(), burst: new Map(), misc: new Map(), cooldown: new Map(),
});

/** Not killed, not at 0 life, and not flagged dead by the latest death toggle. */
export function isAlive(a: EntityActor): boolean {
    if (isKilled(a)) return false;
    const life = a.lifeAt(null);
    if (life !== undefined && life <= 0) return false;
    return !a.deathHistory.at(-1)?.Dead;
}

export interface AlertItem {
    key: number;
    text: string;
    at: number;
    ruleId: string;
    actorId: string;
    castKey: string;
    expireAt: number;
    loud?: boolean;
}

/**
 * Next list of text alerts: drops those whose time is up or whose rule's dismiss reasons apply,
 * drops older ones a new fire replaces, then appends the new ones. Returns `items` itself when unchanged.
 */
export function applyAlerts(o: {
    items: AlertItem[];
    fires: AlertFire[];
    rules: AlertRule[];
    step: Pick<AlertStep, 'holding' | 'ccLive'>;
    nowMs: number;
    nextKey: () => number;
}): AlertItem[] {
    const ruleOf = new Map(o.rules.map(r => [r.id, r]));
    const added = o.fires.filter(f => f.showText);
    const replacing = new Set(added
        .filter(f => ruleOf.get(f.ruleId)?.dismiss.replaced)
        .map(f => `${f.ruleId}:${f.actorId}`));
    const kept = o.items.filter(a => {
        if (o.nowMs >= a.expireAt) return false;
        const pair = `${a.ruleId}:${a.actorId}`;
        if (replacing.has(pair)) return false;
        const rule = ruleOf.get(a.ruleId);
        if (!rule) return true;
        if (rule.dismiss.condFails && rule.conds.length > 0 && !o.step.holding.has(pair)) return false;
        if (rule.dismiss.ccEnds && rule.kind !== 'periodic' && !o.step.ccLive.has(a.castKey)) return false;
        return true;
    });
    if (added.length === 0 && kept.length === o.items.length) return o.items;
    return [...kept, ...added.map(f => ({
        key: o.nextKey(), text: f.text, at: o.nowMs, ruleId: f.ruleId, actorId: f.actorId, castKey: f.castKey, loud: f.loud,
        expireAt: o.nowMs + (ruleOf.get(f.ruleId)?.textKeep ?? 5) * 1000,
    }))];
}

/** One fire per rule and actor; after a time jump the earliest threshold (lowest sec) wins. */
export function dedupeFires(fires: AlertFire[]): AlertFire[] {
    const best = new Map<string, AlertFire>();
    for (const f of fires) {
        const k = `${f.ruleId}:${f.actorId}`;
        const cur = best.get(k);
        if (!cur || f.sec < cur.sec) best.set(k, f);
    }
    return [...best.values()];
}

export function useOverlayData(): OverlayData {
    const settings = ref(loadOverlaySettings());
    const state = ref<OverlayState | null>(null);
    const dps = ref<DpsOverlayVM>({ boss: null, fightSec: null, partyDps: 0, rows: [] });
    const tiles = ref<SectionTiles>(emptyTiles());
    const bossAlive = ref(false);
    const bossPresent = ref(false);
    const alerts = ref<AlertItem[]>([]);
    const tracker = createAlertTracker();
    const cooldowns = createCooldownTracker();
    const arcana = createArcanaTracker(ARCANA_BY_SKILL);
    const speech = createSpeechQueue(globalThis.speechSynthesis ?? null, Date.now);
    let alertKey = 0;
    // null until the main window announces; '' means all targets.
    let announced: string | null = null;

    // Current battle and overlay-relevant events only; older battles are evicted at each boundary.
    const session = createBackendSession({
        url: wsUrl() + '?history=current&scope=overlay',
        history: true,
        onBattleBoundary: (at, present) => { actorManager.value.evictBefore(at, present); dcManager.value.evictBefore(at); },
        onSourceReset: () => {
            skipAll(); // actor cast lists outlive clear(): the old source's must never be counted
            tracker.reset(); cooldowns.reset(); arcana.reset(); alerts.value = []; speech.cancel();
        },
    });
    function skipAll() {
        const map = actorManager.value.entityMap;
        cooldowns.skip(map);
        arcana.skip(Object.values(map));
    }
    const replaying = computed(() => session.source.value?.Mode === 'replay');
    const collectors: Record<string, DamageCollectorBase> = {};
    const dcOf = (attackerId: string) => (collectors[attackerId] ??= dcManager.value.getDualGroupedDamageCollector(
        v => v.Id == attackerId, v => v.TargetId, v => `${v.SkillId}`)) as DualGroupedDamageCollector;
    const targetDC = () => (collectors['*target'] ??= dcManager.value.getGroupedDamageCollector(
        () => true, v => v.TargetId)) as GroupedDamageCollector;

    const nameOf = (aid: string) => {
        const a = actorManager.value.entityMap[aid];
        return prettyEntityName(a, raceNameMap) ?? a?.name ?? aid;
    };

    // The boss line shows the race name alone: no race id, no entity id suffix.
    const bossName = (a: EntityActor) => {
        const race = raceNameMap.value[a.raceId];
        return race ? stripRaceSuffix(a.raceId, race) : 'BOSS';
    };

    // Only live data is shown, so the wall clock is the time.
    const nowSec = () => Date.now() / 1000;

    const targetId = () => resolveOverlayTarget({
        announced, actors: actorManager.value.entityMap, isBoss: isBossRace,
    });

    function pcRows(tid: string) {
        const actors = Object.values(actorManager.value.entityMap).filter(a => a.isPC);
        return buildPlayerRows({
            actors, byAttacker: aid => dcOf(aid).damages, targetId: tid, minAt: null, maxAt: null,
            preaggregated: aid => {
                const dc = dcOf(aid);
                return tid
                    ? { damages: dc.groupedDamages[tid] ?? [], total: dc.groupedTotalDamages[tid] ?? 0 }
                    : { damages: dc.damages, total: dc.totalDamage };
            },
        });
    }

    // The target when it is a boss, else the latest boss.
    function bossActor(tid: string): EntityActor | null {
        const sel = tid ? actorManager.value.entityMap[tid] ?? null : null;
        return titleBoss({ selected: sel, actors: actorManager.value.entityMap, isBoss: isBossRace });
    }

    // Attacker ids with damage, found by scanning only the entries added since the last call.
    const attackers = new Set<string>();
    let scanned = 0;
    let firstSeen: unknown;
    function partyIds(): string[] {
        const list = actorManager.value.damages;
        if (list.length < scanned || list[0] !== firstSeen) { attackers.clear(); scanned = 0; }
        firstSeen = list[0];
        for (; scanned < list.length; scanned++) if (list[scanned].Damage > 0) attackers.add(list[scanned].Id);
        // A pet counts for its owner; the owner may only be learned after the hit.
        const out = new Set<string>();
        for (const aid of attackers) {
            const a = actorManager.value.entityMap[aid];
            const pid = a?.ownerId || aid;
            if (actorManager.value.entityMap[pid]?.isPC) out.add(pid);
        }
        return [...out];
    }

    // Skip the assignment when what is shown is unchanged, so an idle overlay does not re-render.
    let dpsSig = '';
    let tileSig = '';
    // The mask moves every tick; two decimals are enough for the sweep.
    const sigOf = (t: SectionTiles) => JSON.stringify(Object.entries(t).map(([s, m]) => [s, [...m].map(([k, list]) =>
        [k, list.map(x => [x.holderId, x.label, x.icon.id, x.sec, x.state, x.hl, x.faint, Math.round(x.mask * 100), x.isSelf])])]));

    function computeDps() {
        const tid = targetId();
        const b = bossActor(tid);
        const next = buildDpsOverlay({
            rows: pcRows(tid),
            ownerId: actorManager.value.ownerEntityId,
            nameOf,
            boss: b && {
                name: bossName(b),
                maxLife: b.maxLife ?? 0,
                life: b.lifeAt(null),
                dealt: targetDC().groupedTotalDamages[b.id] ?? b.totalTakeDamage,
            },
        });
        const sig = JSON.stringify(next);
        if (sig === dpsSig) return;
        dpsSig = sig;
        dps.value = next;
    }

    function computeCc() {
        const b = bossActor(targetId());
        const now = nowSec();
        const am = actorManager.value;
        const real = am.entityMap;
        const ownerId = am.ownerEntityId;
        // 戰吼 has no CC of its own; it is built from the song's pulse lists.
        const actors = withConditions(real, warcryConditions(am.bardsongPulses, am.bardsongEvents, ownerId, now));
        const party = partyIds();
        const step = tracker.step({
            now, actors, ownerId, partyIds: party, bossId: b?.id ?? '', rules: settings.value.rules,
            nameOf, ccNameOf: id => ccName(condNameMap.value, id),
        });
        arcana.observe(Object.values(real));
        const alive = !!b && isAlive(b);
        if (bossAlive.value !== alive) bossAlive.value = alive;
        if (bossPresent.value !== !!b) bossPresent.value = !!b;
        const next = buildTiles({ now, actors, ownerId, party, boss: alive ? b : null });
        const sig = sigOf(next);
        if (sig !== tileSig) { tileSig = sig; tiles.value = next; }

        announce(dedupeFires(step.fires), step);
    }

    function buildTiles(o: {
        now: number; actors: Record<string, EntityActor>; ownerId: string; party: string[]; boss: EntityActor | null;
    }): SectionTiles {
        const s = settings.value;
        const own = arcana.of(o.ownerId);
        const holder = (id: string): Holder => ({ id, name: nameOf(id), isSelf: id === o.ownerId });
        const self = o.ownerId ? [holder(o.ownerId)] : [];
        const holders: Record<CcSectionId, Holder[]> = {
            ccBoss: o.boss ? [holder(o.boss.id)] : [],
            ccSelf: self,
            ccParty: o.party.filter(id => id !== o.ownerId).map(holder),
            burst: self,
            misc: self,
        };
        const owner = o.actors[o.ownerId];
        const reading = tuairim.value;
        const gauge = (id: string): Gauge | null => id === o.ownerId && reading
            ? gaugeNow(reading, o.now, !!owner && !!activeCondition(owner.conditionMap, TUAIRIM_GAIN_CC, o.now))
            : null;
        const dungeon = session.inDungeon.value;
        const judge = { ccBoss: !!o.boss, ccSelf: dungeon, ccParty: dungeon, burst: false, misc: false };
        const out = emptyTiles();
        for (const id of CC_SECTION_IDS) {
            out[id] = buildCcTiles(s[id], { holders: holders[id], actors: o.actors, now: o.now, ownArcana: own, judgeGone: judge[id], arcanaOf: arcana.of, gauge });
        }
        const skills = s.cooldown.items.filter(i => i.enabled);
        cooldowns.observe(actorManager.value.entityMap, skills, nameOf);
        const rows = cooldowns.rows(o.now, skills, o.ownerId);
        out.cooldown = buildCooldownTiles(s.cooldown, rows, { ownerId: o.ownerId, partyIds: o.party, ownArcana: own });
        return out;
    }

    function announce(fires: AlertFire[], step: AlertStep) {
        if (!layoutOf('alerts', state.value?.layout).enabled) return;
        const next = applyAlerts({
            items: alerts.value, fires, rules: settings.value.rules, step, nowMs: Date.now(), nextKey: () => ++alertKey,
        });
        if (next !== alerts.value) alerts.value = next;
        if (settings.value.voice.muted) return;
        for (const f of fires) if (f.voice) speech.say(f.voiceText, settings.value.voice);
    }

    // Replay data never reaches the overlay or its trackers.
    function blank() {
        skipAll();
        if (dps.value.rows.length || dps.value.boss) { dpsSig = ''; dps.value = { boss: null, fightSec: null, partyDps: 0, rows: [] }; }
        const empty = emptyTiles();
        const sig = sigOf(empty);
        if (sig !== tileSig) { tileSig = sig; tiles.value = empty; }
        if (bossAlive.value) bossAlive.value = false;
        if (bossPresent.value) bossPresent.value = false;
        if (alerts.value.length) alerts.value = [];
    }

    let ticks = 0;
    function tick() {
        if (replaying.value) { blank(); return; }
        computeCc();
        if (ticks++ % DPS_EVERY === 0) computeDps();
    }

    const offs: (() => void)[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    let gone = false;

    onMounted(async () => {
        const reg = async (name: string, cb: (d: unknown) => void) => {
            const off = await onDesktopEvent(name, cb);
            if (off) offs.push(off);
        };
        await reg(OV.settings, d => { settings.value = normalizeOverlaySettings(d); });
        await reg(OV.target, d => {
            const t = (d as { targetId?: unknown } | null)?.targetId;
            if (typeof t === 'string') announced = t;
        });
        await reg(OV.state, d => { if (isOverlayState(d)) state.value = d; });
        if (gone) return;
        session.connect();
        tick();
        timer = setInterval(tick, TICK_MS);
        await emitDesktop(OV.hello, {});
        await emitDesktop(OV.getState);
    });

    onBeforeUnmount(() => {
        gone = true;
        session.close();
        speech.cancel();
        if (timer) clearInterval(timer);
        offs.forEach(o => o());
        for (const c of Object.values(collectors)) dcManager.value.removeDamageCollector(c);
    });

    return { settings, state, dps, tiles, bossAlive, bossPresent, inDungeon: session.inDungeon, alerts, replaying };
}

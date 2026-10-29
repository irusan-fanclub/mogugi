import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { DamageCollectorBase, DualGroupedDamageCollector, GroupedDamageCollector } from '@/actionCollector';
import type { EntityActor } from '@/eventActor';
import { createBackendSession } from '@/lib/backendSession';
import { createAlertTracker, type AlertFire, type AlertStep } from '@/lib/alertRules';
import { buildPlayerRows } from '@/lib/battleStats';
import { emitDesktop, onDesktopEvent } from '@/lib/desktopBridge';
import {
    buildCcOverlay, buildDpsOverlay, formatRemaining, resolveOverlayTarget, type CcOverlayVM, type DpsOverlayVM,
} from '@/lib/overlayModel';
import { layoutOf } from '@/lib/overlayComponents';
import { isOverlayState, OV, type OverlayState } from '@/lib/overlayProtocol';
import { loadOverlaySettings, normalizeOverlaySettings, type AlertRule, type OverlaySettings } from '@/lib/overlaySettings';
import { wsUrl } from '@/lib/runtimeEnv';
import { buildCooldownRows, type CooldownRowVM } from '@/lib/skillCooldown';
import { titleBoss } from '@/lib/targets';
import { ccName, prettyEntityName } from '@/lib/util';
import { actorManager, condNameMap, dcManager, isBossRace, raceNameMap } from '@/store';
import { createSpeechQueue } from './speechQueue';

const TICK_MS = 250;
const DPS_EVERY = 2;

export interface OverlayData {
    settings: Ref<OverlaySettings>;
    state: Ref<OverlayState | null>;
    dps: Ref<DpsOverlayVM>;
    cc: Ref<CcOverlayVM>;
    cooldown: Ref<CooldownRowVM[]>;
    alerts: Ref<AlertItem[]>;
}

export interface AlertItem {
    key: number;
    text: string;
    at: number;
    ruleId: string;
    actorId: string;
    castKey: string;
    expireAt: number;
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
        if (rule.dismiss.ccEnds && rule.kind === 'countdown' && !o.step.ccLive.has(a.castKey)) return false;
        return true;
    });
    if (added.length === 0 && kept.length === o.items.length) return o.items;
    return [...kept, ...added.map(f => ({
        key: o.nextKey(), text: f.text, at: o.nowMs, ruleId: f.ruleId, actorId: f.actorId, castKey: f.castKey,
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
    const cc = ref<CcOverlayVM>({ boss: null, self: null, party: [] });
    const cooldown = ref<CooldownRowVM[]>([]);
    const alerts = ref<AlertItem[]>([]);
    const tracker = createAlertTracker();
    const speech = createSpeechQueue(globalThis.speechSynthesis ?? null, Date.now);
    let alertKey = 0;
    // null until the main window announces; '' means all targets.
    let announced: string | null = null;

    // Current battle and overlay-relevant events only; older battles are evicted at each boundary.
    const session = createBackendSession({
        url: wsUrl() + '?history=current&scope=overlay',
        history: true,
        onBattleBoundary: (at, present) => { actorManager.value.evictBefore(at, present); dcManager.value.evictBefore(at); },
    });
    const collectors: Record<string, DamageCollectorBase> = {};
    const dcOf = (attackerId: string) => (collectors[attackerId] ??= dcManager.value.getDualGroupedDamageCollector(
        v => v.Id == attackerId, v => v.TargetId, v => `${v.SkillId}`)) as DualGroupedDamageCollector;
    const targetDC = () => (collectors['*target'] ??= dcManager.value.getGroupedDamageCollector(
        () => true, v => v.TargetId)) as GroupedDamageCollector;

    const nameOf = (aid: string) => {
        const a = actorManager.value.entityMap[aid];
        return prettyEntityName(a, raceNameMap) ?? a?.name ?? aid;
    };

    // Replay time is the latest damage seen; live (or unknown source) is the wall clock.
    function nowSec(): number {
        if (session.source.value?.Mode === 'replay') {
            const list = actorManager.value.damages;
            if (list.length) return list[list.length - 1].At;
        }
        return Date.now() / 1000;
    }

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
    let ccSig = '';
    let cdSig = '';
    const ccSigOf = (v: CcOverlayVM) => JSON.stringify([
        [v.boss, v.self, ...v.party].map(r => r && [
            r.id, r.name, r.icons.map(i => [i.ccId, i.remaining === null ? '' : formatRemaining(i.remaining), i.expiring]),
        ]),
    ]);

    function computeDps() {
        const tid = targetId();
        const b = bossActor(tid);
        const next = buildDpsOverlay({
            rows: pcRows(tid),
            ownerId: actorManager.value.ownerEntityId,
            nameOf,
            boss: b && {
                name: nameOf(b.id),
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
        const actors = actorManager.value.entityMap;
        const ownerId = actorManager.value.ownerEntityId;
        const party = partyIds();
        const step = tracker.step({
            now, actors, ownerId, partyIds: party, bossId: b?.id ?? '', rules: settings.value.rules,
            nameOf, ccNameOf: id => ccName(condNameMap.value, id),
        });
        const next = buildCcOverlay({
            actors, bossId: b?.id ?? '', ownerId, partyIds: party,
            sections: settings.value.cc.sections, now, nameOf, red: step.red,
        });
        const sig = ccSigOf(next);
        if (sig !== ccSig) { ccSig = sig; cc.value = next; }

        const rows = buildCooldownRows({ actors, now, nameOf })
            .map(r => ({ ...r, isSelf: r.id === ownerId }));
        const cdNext = JSON.stringify(rows.map(r => [r.id, r.name, r.isSelf, r.remaining > 0 ? Math.ceil(r.remaining) : 0]));
        if (cdNext !== cdSig) { cdSig = cdNext; cooldown.value = rows; }

        announce(dedupeFires(step.fires), step);
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

    let ticks = 0;
    function tick() {
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

    return { settings, state, dps, cc, cooldown, alerts };
}

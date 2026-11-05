import type { EntityActor } from '@/eventActor';
import type { AlertKind, AlertRule } from './overlaySettings';
import { activeCondition } from './overlayModel';

export interface AlertFire {
    ruleId: string;
    actorId: string;
    sec: number;
    text: string;
    voiceText: string;
    voice: boolean;
    showText: boolean;
    loud: boolean;
    /** `${ruleId}:${actorId}:${DisableAt}` of the cast that fired; '' for periodic rules. */
    castKey: string;
}

export interface AlertStep {
    fires: AlertFire[];
    /** `${ruleId}:${actorId}` whose condition group holds now. */
    holding: Set<string>;
    /** `${ruleId}:${actorId}:${DisableAt}` of watched casts that are active now. */
    ccLive: Set<string>;
}

// An appear rule fires only for a cast first seen within this of its start: one first seen
// later (overlay opened, reconnect, time jump) was already running.
export const APPEAR_FRESH_SEC = 3;

export interface AlertStepInput {
    now: number;
    actors: Record<string, EntityActor>;
    ownerId: string;
    partyIds: string[];
    bossId: string;
    rules: AlertRule[];
    nameOf: (id: string) => string;
    ccNameOf: (cc: number) => string;
}

const DEFAULT_MESSAGE: Record<AlertKind, string> = {
    countdown: '{名字} {CC} 剩 {秒} 秒',
    periodic: '{名字} 條件成立',
    appear: '{名字} {CC}',
};

export function fillMessage(
    tpl: string, v: { sec: number; name: string; cc: string }, kind: AlertKind = 'countdown',
): string {
    const periodic = kind === 'periodic';
    return (tpl || DEFAULT_MESSAGE[kind])
        .replaceAll('{名字}', v.name)
        .replaceAll('{CC}', periodic ? '' : v.cc)
        .replaceAll('{秒}', kind === 'countdown' ? String(v.sec) : '');
}

function targetIds(rule: AlertRule, i: AlertStepInput): string[] {
    switch (rule.target) {
        case 'boss': return i.bossId ? [i.bossId] : [];
        case 'self': return i.ownerId ? [i.ownerId] : [];
        case 'party': return i.partyIds.filter(id => id !== i.ownerId);
        case 'all': return i.ownerId ? [i.ownerId, ...i.partyIds.filter(id => id !== i.ownerId)] : i.partyIds;
    }
}

function condsHold(rule: AlertRule, actor: EntityActor, now: number): boolean {
    if (rule.conds.length === 0) return true;
    const test = (c: AlertRule['conds'][number]) =>
        (activeCondition(actor.conditionMap, c.ccId, now) !== undefined) === (c.mode === 'present');
    return rule.join === 'or' ? rule.conds.some(test) : rule.conds.every(test);
}

export function createAlertTracker() {
    let lastNow = -Infinity;
    const previous = new Map<string, number>();
    // Appear cast key → whether it was fresh when the tracker first saw it.
    const appearFresh = new Map<string, boolean>();
    const lastPeriodic = new Map<string, number>();

    function step(i: AlertStepInput): AlertStep {
        if (i.now < lastNow) { previous.clear(); lastPeriodic.clear(); appearFresh.clear(); }
        lastNow = i.now;

        const fires: AlertFire[] = [];
        const holding = new Set<string>();
        const ccLive = new Set<string>();
        const seen = new Set<string>();
        const seenPeriodic = new Set<string>();

        for (const rule of i.rules) {
            if (!rule.enabled) continue;
            const periodic = rule.kind === 'periodic';
            const appear = rule.kind === 'appear';
            if (rule.kind === 'countdown' && rule.times.length === 0) continue;
            for (const actorId of targetIds(rule, i)) {
                const actor = i.actors[actorId];
                if (!actor) continue;
                const pairKey = `${rule.id}:${actorId}`;
                const condOk = condsHold(rule, actor, i.now);
                if (condOk) holding.add(pairKey);
                const name = i.nameOf(actorId);

                if (periodic) {
                    if (!condOk) continue;
                    seenPeriodic.add(pairKey);
                    const last = lastPeriodic.get(pairKey);
                    if (last !== undefined && i.now - last < rule.every) continue;
                    lastPeriodic.set(pairKey, i.now);
                    const text = fillMessage(rule.textMessage, { sec: 0, name, cc: '' }, 'periodic');
                    fires.push({
                        ruleId: rule.id, actorId, sec: 0, text,
                        voiceText: rule.voiceMessage ? fillMessage(rule.voiceMessage, { sec: 0, name, cc: '' }, 'periodic') : text,
                        voice: rule.voice, showText: rule.text, loud: rule.loud, castKey: '',
                    });
                    continue;
                }

                const cast = activeCondition(actor.conditionMap, rule.ccId, i.now);
                if (!cast || (cast.DisableAt === 0 && !appear)) continue;

                const key = `${pairKey}:${Math.round((cast.DisableAt - (cast.Shifted ?? 0)) * 1000) / 1000}`;
                seen.add(key);
                ccLive.add(key);
                const remaining = cast.DisableAt - i.now;
                const prev = previous.get(key);
                previous.set(key, remaining);

                // Appear: once per cast fresh at first sight, the first tick its conditions hold.
                if (appear) {
                    if (prev !== undefined) continue;
                    if (!appearFresh.has(key)) appearFresh.set(key, i.now - cast.At <= APPEAR_FRESH_SEC);
                    if (!condOk || !appearFresh.get(key)) { previous.delete(key); continue; }
                    const cc = i.ccNameOf(rule.ccId);
                    const text = fillMessage(rule.textMessage, { sec: 0, name, cc }, 'appear');
                    fires.push({
                        ruleId: rule.id, actorId, sec: 0, text,
                        voiceText: rule.voiceMessage ? fillMessage(rule.voiceMessage, { sec: 0, name, cc }, 'appear') : text,
                        voice: rule.voice, showText: rule.text, loud: rule.loud, castKey: key,
                    });
                    continue;
                }

                if (prev === undefined || !condOk) continue;

                const cc = i.ccNameOf(rule.ccId);
                for (const t of rule.times) {
                    if (prev > t && t >= remaining) {
                        const text = fillMessage(rule.textMessage, { sec: t, name, cc });
                        fires.push({
                            ruleId: rule.id, actorId, sec: t, text,
                            voiceText: rule.voiceMessage ? fillMessage(rule.voiceMessage, { sec: t, name, cc }) : text,
                            voice: rule.voice, showText: rule.text, loud: rule.loud, castKey: key,
                        });
                    }
                }
            }
        }

        for (const key of previous.keys()) if (!seen.has(key)) previous.delete(key);
        for (const key of appearFresh.keys()) if (!seen.has(key)) appearFresh.delete(key);
        for (const key of lastPeriodic.keys()) if (!seenPeriodic.has(key)) lastPeriodic.delete(key);
        return { fires, holding, ccLive };
    }

    /** Forgets every seen cast, for a new event source. */
    function reset() { lastNow = -Infinity; previous.clear(); lastPeriodic.clear(); appearFresh.clear(); }

    return { step, reset };
}

import type { EntityActor } from '@/eventActor';
import { activeCondition, formatRemaining } from './overlayModel';
import { itemKey, type CcSection, type CooldownSection, type IconRef } from './overlaySections';
import type { CooldownRowVM } from './skillCooldown';
import { clockText, gaugePct, secondsToFull, TUAIRIM_CC, type Gauge } from './tuairim';

export type TileState = 'ok' | 'warn' | 'safe' | 'gone' | 'cooling' | 'ready';
export interface TileVM {
    key: string; holderId: string; label: string; icon: IconRef;
    /** Parts of `label` kept apart; `fixedLabel` marks a label (the 信念值 clock) that never changes. */
    itemLabel: string; holderName: string; fixedLabel: boolean;
    /** Seconds text ('' none, 'OK' for a ready cooldown). */
    sec: string;
    state: TileState; hl: boolean; faint: boolean;
    /** Cooldown left as a 0..1 fraction for the sweep mask; 0 = none. */
    mask: number;
    isSelf: boolean;
}
export interface Holder { id: string; name: string; isSelf: boolean }

// Same sentinel as eventActor: a DisableAt this far out means "never expires".
const NO_EXPIRY_SEC = 1e12;

const arcanaHidden = (arcana: number[], own: number | null): boolean =>
    arcana.length > 0 && (own === null || !arcana.includes(own));

export function buildCcTiles(sec: CcSection, i: {
    holders: Holder[]; actors: Record<string, EntityActor>; now: number; ownArcana: number | null; judgeGone: boolean;
    arcanaOf: (id: string) => number | null;
    /** A holder's 信念值, or null when unknown (only the local character's is sent). */
    gauge?: (id: string) => Gauge | null;
}): Map<string, TileVM[]> {
    const out = new Map<string, TileVM[]>();
    for (const item of sec.items) {
        if (!item.enabled || arcanaHidden(item.arcana, i.ownArcana)) continue;
        const key = itemKey(item);
        const tiles: TileVM[] = [];
        for (const h of i.holders) {
            if (arcanaHidden(item.mateArcana, i.arcanaOf(h.id))) continue;
            const conds = i.actors[h.id]?.conditionMap ?? {};
            let matched = 0;
            let cond;
            for (const id of item.ids) {
                cond = activeCondition(conds, id, i.now);
                if (cond) { matched = id; break; }
            }
            const label = sec.look.names === 'label' ? item.label : sec.look.names === 'member' ? h.name : '';
            const tile = {
                key, holderId: h.id, label, mask: 0, isSelf: h.isSelf,
                itemLabel: item.label, holderName: h.name, fixedLabel: false,
            };
            const g = !cond && item.ids.includes(TUAIRIM_CC) ? i.gauge?.(h.id) ?? null : null;
            if (g) {
                // Percent on the icon, the estimated time to fire underneath.
                tiles.push({
                    ...tile, label: clockText(secondsToFull(g)), icon: item.icon, sec: `${gaugePct(g)}%`, fixedLabel: true,
                    state: 'cooling', hl: false, faint: false, mask: 1 - g.value / g.max,
                });
                continue;
            }
            if (!cond) {
                if (!(i.judgeGone && item.goneHl)) continue;
                tiles.push({ ...tile, icon: item.icon, sec: '', state: 'gone', hl: true, faint: false });
                continue;
            }
            const icon: IconRef = item.ids.length > 1 ? { kind: 'cc', id: matched } : item.icon;
            const left = cond.DisableAt === 0 || cond.DisableAt >= NO_EXPIRY_SEC ? null : cond.DisableAt - i.now;
            const secText = left === null ? '' : formatRemaining(left);
            if (left === null || left > item.warnSec) {
                tiles.push({ ...tile, icon, sec: secText, state: 'ok', hl: false, faint: true });
                continue;
            }
            // The game renews only if the renew CC is still on at the buff's expiry, so it must outlast the buff.
            const renew = item.renew > 0 ? activeCondition(conds, item.renew, i.now) : undefined;
            const safe = !!renew && (renew.DisableAt === 0 || renew.DisableAt >= cond.DisableAt);
            tiles.push({ ...tile, icon, sec: secText, state: safe ? 'safe' : 'warn', hl: item.warnHl, faint: false });
        }
        out.set(key, tiles);
    }
    return out;
}

export function buildCooldownTiles(sec: CooldownSection, rows: CooldownRowVM[], i: {
    ownerId: string; partyIds: string[]; ownArcana: number | null;
}): Map<string, TileVM[]> {
    const out = new Map<string, TileVM[]>();
    const rank = (r: CooldownRowVM): number => {
        const n = i.partyIds.indexOf(r.id);
        return n < 0 ? i.partyIds.length : n;
    };
    const isSelf = (r: CooldownRowVM): boolean => !!r.isSelf || r.id === i.ownerId;
    for (const item of sec.items) {
        if (!item.enabled || arcanaHidden(item.arcana, i.ownArcana)) continue;
        const key = itemKey(item);
        const picked = rows.filter(r => {
            if (!r.skills.some(s => s.skillId === item.skillId)) return false;
            if (item.who === 'self') return isSelf(r);
            if (item.who === 'party') return isSelf(r) || i.partyIds.includes(r.id);
            return true;
        }).sort((a, b) =>
            Number(isSelf(b)) - Number(isSelf(a)) || rank(a) - rank(b) || a.name.localeCompare(b.name));
        out.set(key, picked.map(r => {
            const s = r.skills.find(x => x.skillId === item.skillId)!;
            const base = {
                key, holderId: r.id, label: sec.look.names ? r.name : '',
                itemLabel: '', holderName: r.name, fixedLabel: false,
                icon: { kind: 'skill', id: item.skillId } as IconRef, isSelf: isSelf(r), faint: false,
            };
            if (s.remaining > 0) {
                return { ...base, sec: String(Math.ceil(s.remaining)), state: 'cooling' as const, hl: false,
                    mask: s.total > 0 ? Math.min(1, s.remaining / s.total) : 0 };
            }
            return { ...base, sec: 'OK', state: 'ready' as const, hl: true, mask: 0 };
        }));
    }
    return out;
}

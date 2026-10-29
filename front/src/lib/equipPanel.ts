// equipPanel.ts — stat-panel rows and the per-item contribution table, shared by both UIs.
import type { ownerPanel } from '@/protocols';
import {
    EQUIP_SLOTS, STAT_ORDER, STAT_LABELS, contributionsOf, sumContributions, panelValue,
    type Contribution, type SlotEntry, type StatKey,
} from './equipStats';

// Integers as is, otherwise 2 decimals.
export const n = (v: number): string => Number.isInteger(v) ? String(v) : v.toFixed(2);
// Blank for 0 / missing.
export const fmt = (v: number | undefined): string => (v == null || v === 0) ? '' : n(v);

// True when the snapshot (level) is missing, so base values are unknown.
export const baseUnknown = (p: ownerPanel): boolean => !p.level;

export function panelRows(p: ownerPanel): { label: string; value: string }[] {
    const rows = [
        { label: '等級', value: n(p.level) },
        { label: '戰鬥力', value: n(p.combatPower) },
        { label: 'AP', value: n(p.abilityPoints) },
        { label: '生命力', value: `${n(p.life)} / ${n(p.lifeMax)}` },
        { label: '魔力', value: `${n(p.mana)} / ${n(p.manaMax)}` },
        { label: '體力', value: `${n(p.stamina)} / ${n(p.staminaMax)}` },
        { label: '力量', value: `${n(p.str)} + ${n(p.strMod)}` },
        { label: '敏捷', value: `${n(p.dex)} + ${n(p.dexMod)}` },
        { label: '智力', value: `${n(p.int)} + ${n(p.intMod)}` },
        { label: '意志', value: `${n(p.will)} + ${n(p.willMod)}` },
        { label: '幸運', value: `${n(p.luck)} + ${n(p.luckMod)}` },
        { label: p.dualWield ? '攻擊力(右手)' : '攻擊力', value: `${n(p.attackMin)} ~ ${n(p.attackMax)}` },
    ];
    if (p.dualWield) rows.push({ label: '攻擊力(左手)', value: `${n(p.offAttackMin)} ~ ${n(p.offAttackMax)}` });
    rows.push(
        { label: '負傷率', value: `${n(p.injuryMin)} ~ ${n(p.injuryMax)}` },
        { label: '暴擊率', value: n(p.critical) },
        { label: '平衡性', value: n(p.balance) },
        { label: '防禦力(裝備)', value: n(p.defenseMod) },
        { label: '保護(裝備)', value: n(p.protectionMod) },
        { label: '魔法攻擊力(裝備)', value: n(p.magicAttackMod) },
        { label: '魔法防禦力(裝備)', value: n(p.magicDefenseMod) },
        { label: '魔法保護(裝備)', value: n(p.magicProtectionMod) },
    );
    return rows;
}

export interface WornColumn { pocket: number; label: string; name: string; contribution: Contribution }

// One column per worn slot, in EQUIP_SLOTS order.
export function wornColumns(entries: Map<number, SlotEntry>): WornColumn[] {
    const out: WornColumn[] = [];
    for (const s of EQUIP_SLOTS) {
        const e = entries.get(s.pocket);
        if (e) out.push({ pocket: s.pocket, label: s.label, name: e.name, contribution: contributionsOf(e.item, s.pocket) });
    }
    return out;
}

export interface ContribRow {
    key: StatKey; label: string; sum: number;
    server: number | null; isTotal: boolean; diff: number | null;
}

export function contribRows(columns: WornColumn[], p: ownerPanel | null): ContribRow[] {
    const sums = sumContributions(columns.map(c => c.contribution));
    return STAT_ORDER.map((key: StatKey) => {
        const sum = sums[key] ?? 0;
        const pv = p ? panelValue(p, key) : null;
        return {
            key, label: STAT_LABELS[key], sum,
            server: pv ? pv.value : null,
            isTotal: pv ? pv.isTotal : false,
            diff: pv ? pv.value - sum : null,
        };
    });
}

export function skippedSummary(columns: WornColumn[]): string {
    const t = { conditional: 0, metalware: 0, relic: 0 };
    for (const c of columns) {
        t.conditional += c.contribution.skipped.conditional;
        t.metalware += c.contribution.skipped.metalware;
        t.relic += c.contribution.skipped.relic;
    }
    const parts: string[] = [];
    if (t.metalware) parts.push(`細工 ${t.metalware} 項`);
    if (t.relic) parts.push(`遺物效果 ${t.relic} 項`);
    if (t.conditional) parts.push(`條件效果 ${t.conditional} 項`);
    return parts.join(',');
}

export function unmappedSummary(columns: WornColumn[]): string {
    return columns.flatMap(c => c.contribution.unmapped.map(u => `#${u.code}:${u.value}`)).join(' ');
}

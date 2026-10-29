import type { CcOverlayVM, CcRowVM, DpsOverlayVM } from '@/lib/overlayModel';
import type { CooldownRowVM } from '@/lib/skillCooldown';
import type { AlertItem } from './useOverlayData';

const NAMES = ['莉莉安', '阿福', '小雪', '海風', '木棉', '夜鶯', '白狐', '星河'];
const TOTALS = [4.1e6, 3.4e6, 2.9e6, 2.2e6, 1.9e6, 1.4e6, 1.1e6, 0.8e6];
const CC_IDS = [803, 1026, 464, 578, 680, 192];
const REMAINING = [12, 5, 2, 31, 8, 44];

export function sampleDps(): DpsOverlayVM {
    const sum = TOTALS.reduce((a, b) => a + b, 0);
    return {
        boss: { name: '白龍', hpPct: 62.4 },
        fightSec: 83,
        partyDps: 48200,
        rows: TOTALS.map((t, i) => ({
            id: `s${i}`, name: NAMES[i], dps: t / 83, total: t, share: t / sum, isSelf: i === 1,
        })),
    };
}

function ccRow(id: string, name: string, offset: number, count: number): CcRowVM {
    return {
        id, name,
        icons: Array.from({ length: count }, (_, i) => {
            const remaining = REMAINING[(i + offset) % REMAINING.length];
            return { ccId: CC_IDS[(i + offset) % CC_IDS.length], disableAt: 0, remaining, expiring: remaining <= 3 };
        }),
    };
}

export function sampleCc(): CcOverlayVM {
    return {
        boss: ccRow('s-boss', '白龍', 0, 4),
        self: ccRow('s-self', NAMES[1], 3, 2),
        party: [2, 3, 4, 5, 6, 7].map((n, i) => ccRow(`s-p${i}`, NAMES[n], i + 1, 1 + (i % 3))),
    };
}

export function sampleCooldown(): CooldownRowVM[] {
    return [
        { id: 's0', name: NAMES[1], skillId: 59005, remaining: 0, isSelf: true },
        { id: 's1', name: NAMES[0], skillId: 59005, remaining: 95 },
        { id: 's2', name: NAMES[2], skillId: 59005, remaining: 160 },
    ];
}

export function sampleAlerts(): AlertItem[] {
    return [
        { key: -1, text: '白龍 活潑板 剩 5 秒', at: 0, ruleId: '', actorId: '', castKey: '', expireAt: 0 },
        { key: -2, text: '莉莉安 缺少圖安之魂', at: 0, ruleId: '', actorId: '', castKey: '', expireAt: 0 },
    ];
}

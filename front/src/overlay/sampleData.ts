import type { DpsOverlayVM } from '@/lib/overlayModel';
import { itemKey, type CcSection, type CooldownSection } from '@/lib/overlaySections';
import type { TileVM } from '@/lib/overlayTiles';
import type { AlertItem } from './useOverlayData';

// Taken from the 隨機名稱 word bank (FUNNY_NAMES) so previews never look like real players.
export const SAMPLE_NAMES = ['蘑菇雞', '珍珠奶茶', '喵喵拳', '滷肉飯', '跳跳虎', '小籠包', '懶懶熊', '星閃閃'];
const SAMPLE_HOLDER = SAMPLE_NAMES[0];

type SampleItem = CcSection['items'][number] | CooldownSection['items'][number];

function sampleTile(sec: CcSection | CooldownSection, item: SampleItem, holderId: string, holderName: string): TileVM {
    const base = { key: itemKey(item), holderId, hl: false, mask: 0, isSelf: false, holderName, fixedLabel: false };
    if ('skillId' in item) {
        const names = (sec as CooldownSection).look.names;
        return { ...base, label: names ? holderName : '', itemLabel: '', icon: { kind: 'skill', id: item.skillId }, sec: '12', state: 'cooling', faint: false, mask: 0.4 };
    }
    const names = (sec as CcSection).look.names;
    const label = names === 'label' ? item.label : names === 'member' ? holderName : '';
    return { ...base, label, itemLabel: item.label, icon: item.icon, sec: '45', state: 'ok', faint: true };
}

/** One made-up tile per enabled item of a section (or just `keys`), for the layout editor. */
export function sampleTiles(sec: CcSection | CooldownSection, keys?: readonly string[]): TileVM[] {
    const out: TileVM[] = [];
    for (const item of sec.items) {
        if (!item.enabled || (keys && !keys.includes(itemKey(item)))) continue;
        out.push(sampleTile(sec, item, 'sample', SAMPLE_HOLDER));
    }
    return out;
}

/** Three sample teammates, each holding every enabled item of `keys`; key-major like live tiles. */
export function sampleMemberTiles(sec: CcSection | CooldownSection, keys: readonly string[]): TileVM[] {
    const out: TileVM[] = [];
    for (const key of keys) {
        const item = sec.items.find(i => itemKey(i) === key);
        if (!item?.enabled) continue;
        for (let n = 1; n <= 3; n++) out.push(sampleTile(sec, item, `s${n}`, SAMPLE_NAMES[n - 1]));
    }
    return out;
}

const TOTALS = [4.1e6, 3.4e6, 2.9e6, 2.2e6, 1.9e6, 1.4e6, 1.1e6, 0.8e6];

export function sampleDps(): DpsOverlayVM {
    const sum = TOTALS.reduce((a, b) => a + b, 0);
    return {
        boss: { name: '白龍', hpPct: 62.4, life: 624000 },
        fightSec: 83,
        partyDps: 48200,
        rows: TOTALS.map((t, i) => ({
            id: `s${i}`, name: SAMPLE_NAMES[i], dps: t / 83, total: t, share: t / sum, isSelf: i === 1,
        })),
    };
}

export function sampleAlerts(): AlertItem[] {
    return [
        { key: -1, text: '白龍 減少防禦/保護 剩 30 秒', at: 0, ruleId: '', actorId: '', castKey: '', expireAt: 0 },
        { key: -2, text: '戰場的序曲 剩 30 秒，沒有圖安之魂', at: 0, ruleId: '', actorId: '', castKey: '', expireAt: 0 },
    ];
}

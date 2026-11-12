// Demo stand-in for overlay/useOverlayData: sample data instead of the backend socket.
import { computed, ref, type Ref } from 'vue';
import type { DpsOverlayVM } from '@/lib/overlayModel';
import type { OverlaySettings } from '@/lib/overlaySettings';
import type { OverlayState } from '@/lib/overlayProtocol';
import { itemKey, type SectionId } from '@/lib/overlaySections';
import type { TileVM } from '@/lib/overlayTiles';
import { overlaySettings } from '../desktop/overlay/overlayLink';
import { useOverlayState } from '../desktop/overlay/useOverlayState';
import { SAMPLE_NAMES, sampleAlerts, sampleDps } from '../overlay/sampleData';

export interface AlertItem {
    key: number;
    text: string;
    at: number;
    ruleId: string;
    actorId: string;
    castKey: string;
    expireAt: number;
}

/** Demo switch: whether the overlay has battle data (off shows the editor's samples). */
export const inBattle = ref(true);

export interface OverlayData {
    settings: Ref<OverlaySettings>;
    state: Ref<OverlayState | null>;
    dps: Ref<DpsOverlayVM>;
    tiles: Ref<Record<SectionId, Map<string, TileVM[]>>>;
    bossAlive: Ref<boolean>;
    bossPresent: Ref<boolean>;
    inDungeon: Ref<boolean>;
    alerts: Ref<AlertItem[]>;
    replaying: Ref<boolean>;
}

// No live tiles: the overlay editor draws its sample tiles.
const noTiles = (): Record<SectionId, Map<string, TileVM[]>> => ({
    ccBoss: new Map(), ccSelf: new Map(), ccParty: new Map(), burst: new Map(), misc: new Map(), cooldown: new Map(),
});

// Four teammates with different arcana, so 隊伍 CC shows its per-teammate rows.
const MATES = [
    { id: 'm1', name: SAMPLE_NAMES[0], arcana: 1 }, { id: 'm2', name: SAMPLE_NAMES[1], arcana: 3 },
    { id: 'm3', name: SAMPLE_NAMES[2], arcana: 8 }, { id: 'm4', name: SAMPLE_NAMES[3], arcana: 2 },
];
function partyTiles(s: OverlaySettings): Map<string, TileVM[]> {
    const out = new Map<string, TileVM[]>();
    s.ccParty.items.forEach((item, i) => {
        if (!item.enabled) return;
        const key = itemKey(item);
        const tiles: TileVM[] = [];
        MATES.forEach((m, j) => {
            if (item.mateArcana.length && !item.mateArcana.includes(m.arcana)) return;
            if ((i + j) % 5 === 4) return; // someone without it
            const left = 20 + ((i * 37 + j * 53) % 160);
            const label = s.ccParty.look.names === 'label' ? item.label : s.ccParty.look.names === 'member' ? m.name : '';
            tiles.push({
                key, holderId: m.id, label, itemLabel: item.label, holderName: m.name, fixedLabel: false, icon: item.icon,
                sec: String(left), state: left <= item.warnSec ? 'warn' : 'ok', hl: left <= item.warnSec && item.warnHl,
                faint: left > item.warnSec, mask: 0, isSelf: false,
            });
        });
        out.set(key, tiles);
    });
    return out;
}

export function useOverlayData(): OverlayData {
    const empty = <T>(full: T, none: T) => computed(() => (inBattle.value ? full : none));
    return {
        settings: overlaySettings,
        state: useOverlayState().state,
        dps: empty(sampleDps(), { boss: null, fightSec: null, partyDps: 0, rows: [] }) as Ref<DpsOverlayVM>,
        tiles: computed(() => (inBattle.value ? { ...noTiles(), ccParty: partyTiles(overlaySettings.value) } : noTiles())),
        bossAlive: inBattle,
        bossPresent: inBattle,
        inDungeon: inBattle,
        alerts: empty(sampleAlerts(), []) as Ref<AlertItem[]>,
        replaying: ref(false),
    };
}

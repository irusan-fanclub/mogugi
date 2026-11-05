// Demo stand-in for overlay/useOverlayData: sample data instead of the backend socket.
import { computed, ref, type Ref } from 'vue';
import type { DpsOverlayVM } from '@/lib/overlayModel';
import type { OverlaySettings } from '@/lib/overlaySettings';
import type { OverlayState } from '@/lib/overlayProtocol';
import type { SectionId } from '@/lib/overlaySections';
import type { TileVM } from '@/lib/overlayTiles';
import { overlaySettings } from '../desktop/overlay/overlayLink';
import { useOverlayState } from '../desktop/overlay/useOverlayState';
import { sampleAlerts, sampleDps } from '../overlay/sampleData';

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
}

// No live tiles: the overlay editor draws its sample tiles.
const noTiles = (): Record<SectionId, Map<string, TileVM[]>> => ({
    ccBoss: new Map(), ccSelf: new Map(), ccParty: new Map(), burst: new Map(), misc: new Map(), cooldown: new Map(),
});

export function useOverlayData(): OverlayData {
    const empty = <T>(full: T, none: T) => computed(() => (inBattle.value ? full : none));
    return {
        settings: overlaySettings,
        state: useOverlayState().state,
        dps: empty(sampleDps(), { boss: null, fightSec: null, partyDps: 0, rows: [] }) as Ref<DpsOverlayVM>,
        tiles: ref(noTiles()),
        bossAlive: inBattle,
        bossPresent: inBattle,
        inDungeon: inBattle,
        alerts: empty(sampleAlerts(), []) as Ref<AlertItem[]>,
    };
}

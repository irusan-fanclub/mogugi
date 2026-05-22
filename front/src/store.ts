import { ref, shallowRef, computed } from 'vue';
import { MabiDB } from '@/mabidb';
import { ActorManager } from '@/eventActor';
import { DamageCollectorManager } from '@/actionCollector';

export const loadingCount = ref(0);
export const isLoading = computed(() => loadingCount.value > 0);

const defaultRegion = 'tw';

export const region = ref(defaultRegion);
export const lang = ref(defaultRegion);
export const regionList = ref([defaultRegion]);

export const db = computed(() => {
    const instance = new MabiDB(region.value, lang.value);

    // // fire and forget
    // instance.open().catch(e => console.error(e));

    return instance;
});

export const raceNameMap = ref<Record<number, string>>({});
export const skillNameMap = ref<Record<number, string>>({});
export const condNameMap = ref<Record<number, string>>({});
export const itemNameMap = ref<Record<number, string>>({});
export const appEvent = ref(new EventTarget());

export const dcManager = shallowRef(new DamageCollectorManager());
export const actorManager = shallowRef(new ActorManager(dcManager.value as DamageCollectorManager));

export const timeRangeMin = ref<number | null>(null);
export const timeRangeMax = ref<number | null>(null);
export const hasTimeRange = computed(() => timeRangeMin.value !== null && timeRangeMax.value !== null);

export function setTimeRange(min: number, max: number) {
    timeRangeMin.value = min;
    timeRangeMax.value = max;
}

export function clearTimeRange() {
    timeRangeMin.value = null;
    timeRangeMax.value = null;
}

// config
const CONFIG_STORAGE_KEY = 'config';

export interface AppConfig {
    hiddenCCIds: number[];
    hiddenRaceIds: number[];
    autoSelectBoss: boolean;
}

const defaultConfig: AppConfig = {
    hiddenCCIds: [],
    hiddenRaceIds: [],
    autoSelectBoss: true,
};

function loadConfig(): AppConfig {
    try {
        const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...defaultConfig };
}

function saveConfig() {
    const data: AppConfig = {
        hiddenCCIds: [...hiddenCCIds.value],
        hiddenRaceIds: [...hiddenRaceIds.value],
        autoSelectBoss: autoSelectBoss.value,
    };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(data));
}

const _config = loadConfig();

export const hiddenCCIds = ref<Set<number>>(new Set(_config.hiddenCCIds));

export function addHiddenCC(ccId: number) {
    hiddenCCIds.value = new Set(hiddenCCIds.value).add(ccId);
    saveConfig();
}

export function removeHiddenCC(ccId: number) {
    const next = new Set(hiddenCCIds.value);
    next.delete(ccId);
    hiddenCCIds.value = next;
    saveConfig();
}

export const hiddenRaceIds = ref<Set<number>>(new Set(_config.hiddenRaceIds));

export function addHiddenRace(raceId: number) {
    hiddenRaceIds.value = new Set(hiddenRaceIds.value).add(raceId);
    saveConfig();
}

export function removeHiddenRace(raceId: number) {
    const next = new Set(hiddenRaceIds.value);
    next.delete(raceId);
    hiddenRaceIds.value = next;
    saveConfig();
}

// Auto-select boss target in tab 3.
export const autoSelectBoss = ref(_config.autoSelectBoss);
export const BOSS_RACE_IDS = new Set([4860, 7600, 7601, 7602, 7603, 7160, 7615]);

export function setAutoSelectBoss(v: boolean) {
    autoSelectBoss.value = v;
    saveConfig();
}
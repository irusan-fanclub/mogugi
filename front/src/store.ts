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
// enchant (OptionSet) id -> plain localized name, e.g. 11107 -> 生命.
export const enchantNameMap = ref<Record<number, string>>({});

// tooltip 資料：賦予完整資訊與細緻工匠能力表。
export interface EnchantInfo { name: string; level: number | null; desc: string | null }
export const enchantInfoMap = ref<Record<number, EnchantInfo>>({});
export interface ItemUpgrade { name: string; desc: string | null }
export const itemUpgradeMap = ref<Record<number, ItemUpgrade>>({});
export interface ManualForm { name: string; productItemId: number | null; level: number | null }
export const manualFormMap = ref<Record<number, ManualForm>>({});
export interface MetalwareAbility {
    name: string; init: number; per: number; max: number;
    standard: number; isFloat: boolean; subDesc: string;
}
export const metalwareMap = ref<Record<number, MetalwareAbility>>({});
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
    hiddenTrackIds: string[];
    hiddenSkillColumns: string[];
    skillColumnOrder: string[];
    skillRowLimit: number;
    showPetSkills: boolean;
    autoSelectBoss: boolean;
    bossOnlyTarget: boolean;
}

const defaultConfig: AppConfig = {
    hiddenCCIds: [],
    hiddenTrackIds: [],
    // Shown by default: 命中次數 (fixed), 爆擊次數, 爆擊率, 爆擊平均, 非爆平均, 最高.
    hiddenSkillColumns: [
        'castCount', 'normalCount', 'avg', 'min', 'critMin', 'critMax',
        'normalMin', 'normalMax', 'critSummary', 'normalSummary',
    ],
    skillColumnOrder: [],
    skillRowLimit: 0,
    showPetSkills: false,
    autoSelectBoss: true,
    bossOnlyTarget: false,
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
        hiddenTrackIds: [...hiddenTrackIds.value],
        hiddenSkillColumns: [...hiddenSkillColumns.value],
        skillColumnOrder: [...skillColumnOrder.value],
        skillRowLimit: skillRowLimit.value,
        showPetSkills: showPetSkills.value,
        autoSelectBoss: autoSelectBoss.value,
        bossOnlyTarget: bossOnlyTarget.value,
    };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(data));
}

const _config = loadConfig();

// Optional columns of the skill table. Count, damage, DPS and share are not
// in here — they are what the table is for.
export const hiddenSkillColumns = ref<Set<string>>(new Set(_config.hiddenSkillColumns));

// 0 means no limit. A pet's own output is redirected onto its owner, so
// without this it shows up as the player's skill; a summon (人偶) is the
// player's own output and is never filtered.
export const skillRowLimit = ref<number>(_config.skillRowLimit);
export const showPetSkills = ref<boolean>(_config.showPetSkills);

export function setSkillRowLimit(n: number) {
    // Free text input, so guard the value here rather than at the field:
    // a blank box, a decimal or a negative all mean "no limit".
    skillRowLimit.value = Math.max(0, Math.floor(n) || 0);
    saveConfig();
}

export function setShowPetSkills(on: boolean) {
    showPetSkills.value = on;
    saveConfig();
}

// Empty means "the order the component declares"; a saved order is merged
// with that list so a newly added column still appears.
export const skillColumnOrder = ref<string[]>([..._config.skillColumnOrder]);

export function setSkillColumnOrder(keys: string[]) {
    skillColumnOrder.value = [...keys];
    saveConfig();
}

// Restores every skill-table setting from defaultConfig, so there is no second
// copy of the defaults to fall out of step with the first.
export function resetSkillSettings() {
    hiddenSkillColumns.value = new Set(defaultConfig.hiddenSkillColumns);
    skillColumnOrder.value = [...defaultConfig.skillColumnOrder];
    skillRowLimit.value = defaultConfig.skillRowLimit;
    showPetSkills.value = defaultConfig.showPetSkills;
    saveConfig();
}

export function toggleSkillColumn(key: string) {
    const next = new Set(hiddenSkillColumns.value);
    if (next.has(key)) next.delete(key); else next.add(key);
    hiddenSkillColumns.value = next;
    saveConfig();
}

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

// Synthetic-track visibility (e.g. 'cc:516'). Kept separate from hiddenCCIds:
// that one is keyed by real numeric CCIds, and stuffing string track ids in
// there would force fake numeric ids nobody could interpret later.
export const hiddenTrackIds = ref<Set<string>>(new Set(_config.hiddenTrackIds));

export function hideTrack(id: string) {
    hiddenTrackIds.value = new Set(hiddenTrackIds.value).add(id);
    saveConfig();
}

export function unhideTrack(id: string) {
    const next = new Set(hiddenTrackIds.value);
    next.delete(id);
    hiddenTrackIds.value = next;
    saveConfig();
}

// Auto-select boss target in tab 3.
export const autoSelectBoss = ref(_config.autoSelectBoss);
export const BOSS_RACE_IDS = new Set([4860, 7600, 7601, 7602, 7603, 7160, 7615]);

export function setAutoSelectBoss(v: boolean) {
    autoSelectBoss.value = v;
    saveConfig();
}

// Target select filtered down to boss races only.
export const bossOnlyTarget = ref(_config.bossOnlyTarget);

export function setBossOnlyTarget(v: boolean) {
    bossOnlyTarget.value = v;
    saveConfig();
}
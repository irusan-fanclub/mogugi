import { ref, shallowRef, computed } from 'vue';
import { MabiDB } from '@/mabidb';
import { ActorManager } from '@/eventActor';
import { DamageCollectorManager } from '@/actionCollector';
import type { ownerEquipmentItem, ownerPanel } from '@/protocols';
import { effectiveBossRaces, addBossRace, removeBossRace, hasBossRaceOverrides, type BossRaceOverrides } from '@/lib/bossRaces';
import { settingsStorage } from '@/lib/settingsStorage';

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

// Live packet-capture status, fed by the backend watchdog over the socket
// (App.vue) and seeded via GET /api/status as a fallback (about.vue).
// null means "not known yet" — never overload it with all-false.
export interface CaptureStatus {
    npcapOk: boolean;
    gameDetected: boolean;
    capturing: boolean;
    lastPacketAt: number;
}
export const captureStatus = ref<CaptureStatus | null>(null);

// Equipment-analysis tab: the local character's worn set and stat panel, fed over the
// socket (App.vue). Empty/null until the first 0x5209 snapshot.
export const ownerEquipment = ref<ownerEquipmentItem[]>([]);
export const ownerStats = ref<ownerPanel | null>(null);

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
    hiddenSkillColumns: string[];
    skillColumnOrder: string[];
    seenSkillColumns: string[];
    skillRowLimit: number;
    showPetSkills: boolean;
    autoSelectBoss: boolean;
    bossOnlyTarget: boolean;
    // User edits to the built-in boss race list (see lib/bossRaces.ts).
    bossRaceAdded: number[];
    bossRaceRemoved: number[];
    hpGuideStep: number;
    showCastTicks: boolean;
    showHpRuler: boolean;
    showInvincible: boolean;
    hiddenTargetRaces: number[];
}

// Hidden-by-default columns added after users already saved a hidden list;
// a saved config that predates one gets it hidden on load.
const LATER_HIDDEN_SKILL_COLUMNS = ['hitsPerMin'];

const defaultConfig: AppConfig = {
    // Shown by default: 命中次數 (fixed), 爆擊次數, 爆擊率, 爆擊平均, 非爆平均, 最高.
    hiddenSkillColumns: [
        'hitsPerMin', 'castCount', 'normalCount', 'avg', 'min', 'critMin', 'critMax',
        'normalMin', 'normalMax', 'critSummary', 'normalSummary',
    ],
    skillColumnOrder: [],
    seenSkillColumns: LATER_HIDDEN_SKILL_COLUMNS,
    skillRowLimit: 0,
    showPetSkills: false,
    autoSelectBoss: true,
    bossOnlyTarget: false,
    bossRaceAdded: [],
    bossRaceRemoved: [],
    hpGuideStep: 25,
    showCastTicks: true,
    showHpRuler: true,
    showInvincible: true,
    hiddenTargetRaces: [],
};

function loadConfig(): AppConfig {
    try {
        const raw = settingsStorage.getItem(CONFIG_STORAGE_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            const seen: string[] = saved.seenSkillColumns ?? [];
            const hidden: string[] = saved.hiddenSkillColumns ?? defaultConfig.hiddenSkillColumns;
            const unseen = LATER_HIDDEN_SKILL_COLUMNS.filter(k => !seen.includes(k));
            return { ...defaultConfig, ...saved, hiddenSkillColumns: [...hidden, ...unseen] };
        }
    } catch { /* ignore */ }
    return { ...defaultConfig };
}

function saveConfig() {
    const data: AppConfig = {
        hiddenSkillColumns: [...hiddenSkillColumns.value],
        skillColumnOrder: [...skillColumnOrder.value],
        seenSkillColumns: LATER_HIDDEN_SKILL_COLUMNS,
        skillRowLimit: skillRowLimit.value,
        showPetSkills: showPetSkills.value,
        autoSelectBoss: autoSelectBoss.value,
        bossOnlyTarget: bossOnlyTarget.value,
        bossRaceAdded: [...bossRaceOverrides.value.added],
        bossRaceRemoved: [...bossRaceOverrides.value.removed],
        hpGuideStep: hpGuideStep.value,
        showCastTicks: showCastTicks.value,
        showHpRuler: showHpRuler.value,
        showInvincible: showInvincible.value,
        hiddenTargetRaces: [...hiddenTargetRaces.value],
    };
    settingsStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(data));
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

// Auto-select boss target in tab 3.
export const autoSelectBoss = ref(_config.autoSelectBoss);
// Boss race set = built-in list (lib/bossRaces.ts) plus/minus the user's
// edits from the settings dialog; a saved list that is not an array is
// treated as empty.
const numList = (v: unknown): number[] => Array.isArray(v) ? v.filter(x => Number.isInteger(x) && x > 0) : [];
export const bossRaceOverrides = ref<BossRaceOverrides>({
    added: numList(_config.bossRaceAdded), removed: numList(_config.bossRaceRemoved),
});
export const bossRaceIds = computed(() => effectiveBossRaces(bossRaceOverrides.value));
export const bossRacesChanged = computed(() => hasBossRaceOverrides(bossRaceOverrides.value));

export function isBossRace(raceId: number): boolean {
    return bossRaceIds.value.has(raceId);
}

export function addBossRaceId(id: number) {
    bossRaceOverrides.value = addBossRace(bossRaceOverrides.value, id);
    saveConfig();
}

export function removeBossRaceId(id: number) {
    bossRaceOverrides.value = removeBossRace(bossRaceOverrides.value, id);
    saveConfig();
}

export function resetBossRaces() {
    bossRaceOverrides.value = { added: [], removed: [] };
    saveConfig();
}

export function setAutoSelectBoss(v: boolean) {
    autoSelectBoss.value = v;
    saveConfig();
}

// Monster races left out of the battle tab's target list.
export const hiddenTargetRaces = ref<Set<number>>(new Set(numList(_config.hiddenTargetRaces)));

export function setHiddenTargetRaces(races: Set<number>) {
    hiddenTargetRaces.value = races;
    saveConfig();
}

// Boss HP % between the timeline's dashed guides; 0 hides them. Marks only exist at 5% steps.
export const HP_GUIDE_STEPS = [0, 5, 10, 20, 25, 50] as const;
const validGuideStep = (v: unknown) => (HP_GUIDE_STEPS as readonly unknown[]).includes(v) ? v as number : defaultConfig.hpGuideStep;
export const hpGuideStep = ref(validGuideStep(_config.hpGuideStep));

export function setHpGuideStep(v: number) {
    hpGuideStep.value = validGuideStep(v);
    saveConfig();
}

// DPS chart marks the 一般 settings can turn off: cast ticks on the CC lanes, the HP ruler band, the invincible tint.
export const showCastTicks = ref(_config.showCastTicks !== false);
export const showHpRuler = ref(_config.showHpRuler !== false);
export const showInvincible = ref(_config.showInvincible !== false);
export function setShowCastTicks(v: boolean) { showCastTicks.value = v; saveConfig(); }
export function setShowHpRuler(v: boolean) { showHpRuler.value = v; saveConfig(); }
export function setShowInvincible(v: boolean) { showInvincible.value = v; saveConfig(); }

// Target select filtered down to boss races only.
export const bossOnlyTarget = ref(_config.bossOnlyTarget);

export function setBossOnlyTarget(v: boolean) {
    bossOnlyTarget.value = v;
    saveConfig();
}
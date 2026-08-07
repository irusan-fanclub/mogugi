// entityAlias.ts — session-only display aliases for player characters.
// Keyed by the real character name, not the entity id: ids are rebuilt on a
// session reset (channel switch), which would drop the alias.
import { ref, computed } from 'vue';

const aliasMap = ref<Record<string, string>>({});

// Playful stand-in names, picked without repeats inside one session.
export const FUNNY_NAMES: string[] = [
    '蘑菇雞', '小米糕', '糖醋魚', '蔥抓餅', '珍珠奶茶',
    '鹹酥雞', '烤地瓜', '豆花妹', '麻辣鍋', '章魚燒',
    '銅鑼燒', '可麗餅', '爆米花', '雞蛋糕', '芋圓球',
    '仙草凍', '鳳梨酥', '蚵仔煎', '大腸包', '滷肉飯',
    '哞哞叫', '汪汪隊', '喵喵拳', '咕咕鐘', '呱呱叫',
    '嘎嘎獸', '跳跳虎', '慢慢龜', '笨笨鵝', '胖胖鼠',
    '飛飛鼠', '懶懶熊', '滾滾豬', '蹦蹦鹿', '啾啾鳥',
    '嗡嗡蜂', '扭扭蛇', '噗噗鯨', '抖抖兔', '呆呆羊',
    '亮晶晶', '圓滾滾', '軟綿綿', '涼颼颼', '香噴噴',
    '熱呼呼', '脆卡卡', '黏答答', '金光閃', '火冒冒',
    '電啪啪', '風咻咻', '雪白白', '雷轟轟', '水汪汪',
    '霧濛濛', '星閃閃', '月彎彎', '雲飄飄', '土黃黃',
];

export function aliasOf(realName: string): string | undefined {
    return aliasMap.value[realName];
}

// setAlias with a blank value, or one equal to the real name, clears instead.
export function setAlias(realName: string, alias: string): void {
    const next = { ...aliasMap.value };
    const trimmed = (alias ?? '').trim();
    if (!trimmed || trimmed === realName) delete next[realName];
    else next[realName] = trimmed;
    aliasMap.value = next;
}

export function clearAlias(realName: string): void {
    setAlias(realName, '');
}

export function clearAllAliases(): void {
    aliasMap.value = {};
}

export const hasAnyAlias = computed(() => Object.keys(aliasMap.value).length > 0);

// pickName returns a name absent from `taken`, appending a numeric suffix
// once the word bank is exhausted.
function pickName(taken: Set<string>): string {
    const free = FUNNY_NAMES.filter(n => !taken.has(n));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    for (let round = 2; ; round++) {
        const pool = FUNNY_NAMES.map(n => `${n}${round}`).filter(n => !taken.has(n));
        if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
}

// knownRealNames is the roster on screen. Without it a single re-roll could
// hand out an alias equal to some other player's still-unaliased real name,
// which is exactly the confusion this feature exists to remove.
export function randomAlias(realName: string, knownRealNames: string[] = []): void {
    const taken = new Set(Object.entries(aliasMap.value)
        .filter(([k]) => k !== realName)
        .map(([, v]) => v));
    for (const n of knownRealNames) taken.add(n);
    taken.add(realName);
    setAlias(realName, pickName(taken));
}

// randomizeAll replaces the whole map so the batch is guaranteed collision
// free, including against the real names themselves.
export function randomizeAll(realNames: string[]): void {
    const next: Record<string, string> = {};
    const taken = new Set<string>(realNames);
    for (const name of realNames) {
        const picked = pickName(taken);
        taken.add(picked);
        next[name] = picked;
    }
    aliasMap.value = next;
}

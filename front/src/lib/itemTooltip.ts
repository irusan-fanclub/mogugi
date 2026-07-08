// itemTooltip: 純函式（無框架、無反應式依賴）組出遊戲風 tooltip 的領域邏輯。
// buildTip / displayName 皆以 deps 物件注入所需的名稱對照表與 helper，
// 由 itemIndex.vue 傳入反應式 map 的 .value。
import { parseItemMetadata, type Holder, type IndexEnchantEffect } from './itemIndex';
import type { EnchantInfo, ItemUpgrade, ManualForm, MetalwareAbility } from '@/store';

// 賦予等級 → 遊戲位階字母（level 1=F … 6=A, 7=9, 8=8 …15=1）。
const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', '9', '8', '7', '6', '5', '4', '3', '2', '1'];

// 遺物效果碼 → 顯示名（kind-11；逐項與遊戲 tooltip 對照）。
const RELIC_EFFECT_NAMES: Record<number, string> = {
    2558: '死亡準星傷害',
};

// 效果行參數碼 → 顯示名（由 OptionList SetParamOnEquip 逐行對照驗證）。
const PARAM_NAMES: Record<number, string> = {
    1: '最大生命值', 3: '最大魔法值', 16: '最大傷害', 19: '暴擊率',
    20: '保護', 22: '平衡性', 53: '魔法攻擊力', 54: '魔法保護', 178: '人偶最大傷害',
};

// 裝備等級（大師）加成類型：IMRBT=類型（4=衣物 最大生命力、6=武器 額外傷害值，
// 皆已對照遊戲 tooltip 驗證）。
const IMRB_TYPES: Record<string, string> = { 4: '最大生命力增加', 6: '額外傷害值增加' };

// 遺物欄位（系統 pocket）範圍：32-35。
export const RELIC_POCKET_MIN = 32;
export const RELIC_POCKET_MAX = 35;
export function isRelicPocket(pocket?: number): boolean {
    return pocket !== undefined && pocket >= RELIC_POCKET_MIN && pocket <= RELIC_POCKET_MAX;
}

// 已確認的系統 pocket 名稱（無對應包包物品，靠實測命名）。
export const POCKET_NAMES: Record<number, string> = {
    32: '遺物欄位1',  // 穆利亞斯的遺物 實測
    33: '遺物欄位2',
    34: '遺物欄位3',
    35: '遺物欄位4',
    49: '專用物品欄', // 亞多利爾的號角 實測
    51: '威光欄位',
    53: 'VIP物品欄',  // 卡絲妮亞硬幣 實測（尊榮生活VIP服務物品欄）
    54: '星塵欄位',
    56: '釣魚桶',     // 亞布內亞鯉魚 實測（固定 pocket，桶自身 @12=0）
    61: '點數包包',   // 三劍客的護手禮劍放置架 實測
    65: '貨幣保管箱',
    72: '擴張物品欄', // 冬季可愛大提琴 實測（也放各種背包）
};

// TooltipDeps：buildTip / displayName 所需的名稱對照表與 helper（純值，非反應式）。
export interface TooltipDeps {
    enchantNameMap: Record<number, string>;
    enchantInfoMap: Record<number, EnchantInfo>;
    metalwareMap: Record<number, MetalwareAbility>;
    manualFormMap: Record<number, ManualForm>;
    itemUpgradeMap: Record<number, ItemUpgrade>;
    itemDescMap: Record<number, string>;
    // itemName: item id → 純名稱（已去掉結尾 id）。
    itemName: (id: number) => string;
}

interface TipEnchant { slot: string; name: string; rank: string | null; desc: string | null }
interface TipMetalware { name: string; level: number; max: number; value: string | null }
export interface Tip {
    props: string[];
    imprint: string | null;
    enchants: TipEnchant[];
    bless: string[];
    relic: string[];
    relicDesc: string | null;
    upgrades: string[];
    special: string | null;
    energy: string | null;
    metalware: TipMetalware[];
    colorGroups: { label: string; colors: string[] }[];
}

// displayName: 仿遊戲命名——
//   卷軸/魔法粉（給予賦予）：「魔力賦予卷軸 - 生命」（物品名 - 賦予名）
//   裝備（已附加賦予）：「辛勤的 杜克獵人手套」（賦予名前置，接頭 接尾 物品名）
export function displayName(h: Holder, deps: TooltipDeps): string {
    // 衣服樣本/設計圖：FORMID 直接對到完整名「衣服樣本 - X」。
    const formId = Number(parseItemMetadata(h.metadata).FORMID);
    if (formId) {
        const mf = deps.manualFormMap[formId];
        if (mf) return mf.name;
    }
    const label = (id: number) => deps.enchantNameMap[id] ?? `${id}`;
    const parts: string[] = [];
    if (h.enchantPrefix) parts.push(label(h.enchantPrefix));
    if (h.enchantSuffix) parts.push(label(h.enchantSuffix));
    const base = deps.itemName(h.id);
    if (!parts.length) return base;
    return /卷軸|魔法粉/.test(base)
        ? `${base} - ${parts.join(' - ')}`
        : `${parts.join(' ')} ${base}`;
}

// buildTip: 組出遊戲風格 tooltip 的各區塊；全空回 null（不掛 tooltip）。
export function buildTip(h: Holder, deps: TooltipDeps): Tip | null {
    const meta = parseItemMetadata(h.metadata);

    const props: string[] = [];
    if (h.attackMax) props.push(`攻擊 ${h.attackMin ?? 0}~${h.attackMax}`);
    if (h.injuryMax) props.push(`負傷率 ${h.injuryMin ?? 0}~${h.injuryMax}%`);
    if (h.critical) props.push(`暴擊率 ${h.critical}%`);
    if (h.balance) props.push(`平衡性 ${h.balance}%`);
    if (h.defense) props.push(`防禦力 ${h.defense}`);
    if (h.protection) props.push(`保護 ${h.protection}`);
    if (meta.MDEF) props.push(`魔法防禦力 ${meta.MDEF}`);
    if (meta.MPROT) props.push(`魔法保護 ${meta.MPROT}`);
    if (h.durabilityMax) {
        // 衣服樣本/設計圖的「耐久」欄位其實是剩餘使用次數。
        props.push(meta.FORMID
            ? `剩餘使用次數 ${Math.floor((h.durability ?? 0) / 1000)}`
            : `耐久度 ${Math.floor((h.durability ?? 0) / 1000)}/${Math.floor(h.durabilityMax / 1000)}`);
    }
    if (meta.OWNER) props.push(`${meta.OWNER} 專用物品`);
    if (meta.SICID) props.push(`外型變更道具：${deps.itemName(Number(meta.SICID))}`);

    // 裝備等級（大師）加成：IMRBT=類型、IMRBV=實際 %。
    const imprint = meta.IMRBV
        ? `${IMRB_TYPES[meta.IMRBT] ?? '裝備等級加成'} ${meta.IMRBV}%`
        : null;

    const enchants: TipEnchant[] = [];
    const pushEnchant = (slot: string, id?: number) => {
        if (!id) return;
        const info = deps.enchantInfoMap[id];
        enchants.push({
            slot,
            name: info?.name ?? `${id}`,
            rank: info?.level ? (RANKS[info.level - 1] ?? `${info.level}`) : null,
            // 描述含字面兩字元 "\n"（XML 逸出），轉真換行由 CSS pre-line 呈現。
            desc: info?.desc ? info.desc.replaceAll('\\n', '\n') : null,
        });
    };
    pushEnchant('接頭', h.enchantPrefix);
    pushEnchant('接尾', h.enchantSuffix);

    // 賦予效果的逐件實際值（kind-0=接頭 / kind-1=接尾）：依槽內嵌到該槽
    // 效果文字的範圍處，仿遊戲「最大傷害 55 增加(50~55)」。
    // 有範圍的效果行（如 +(50~55)）才有浮動值可嵌；固定值行（保護+3）
    // 的實際值與文字相同，不另顯示。範圍行以「值落在範圍內」配對。
    const inline = (slot: string, effects?: IndexEnchantEffect[]) => {
        const e = enchants.find(x => x.slot === slot);
        const queue = (effects ?? []).map(r => r.value);
        if (!e?.desc || !queue.length) return;
        e.desc = e.desc.replace(/\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?/g, m => {
            const [lo, hi] = m.split('~').map(Number);
            const i = queue.findIndex(v => v >= lo && v <= hi);
            return i >= 0 ? `${queue.splice(i, 1)[0]} (${m})` : m;
        });
    };
    inline('接頭', h.prefixEffects);
    inline('接尾', h.suffixEffects);

    // 聖水（祝福）效果。
    const bless = (h.blessEffects ?? []).map(e =>
        `${PARAM_NAMES[e.code] ?? `#${e.code}`} ${e.value > 0 ? '+' : ''}${e.value}`);

    // 遺物效果（kind-11 動態值 + 物品說明裡的固定效果文字）。
    const relic = (h.relicEffects ?? []).map(e =>
        `${RELIC_EFFECT_NAMES[e.code] ?? `效果#${e.code}`} 增加${e.value}%`);
    const relicDesc = isRelicPocket(h.pocket) && deps.itemDescMap[h.id]
        ? deps.itemDescMap[h.id].replaceAll('\\n', '\n') : null;

    // 改造（UPR1..n）："upgrade_id,effect_id,v1,v2,..." → 名稱＋該次數值。
    const upgrades: string[] = [];
    for (let i = 1; i <= 9; i++) {
        const raw = meta[`UPR${i}`];
        if (!raw) continue;
        const f = raw.split(',');
        const upId = Number(f[0]);
        const vals = f.slice(2).map(v => (Number(v) > 0 ? `+${v}` : v)).join(', ');
        upgrades.push(`${deps.itemUpgradeMap[upId]?.name ?? `改造#${upId}`}（${vals}）`);
    }
    // 特殊改造（EHTY 1024=R / 512=S 🟡，EHLV=階段）與聚能（IMEEL/IMEEML）。
    const special = meta.EHLV
        ? `特殊改造 ${meta.EHTY === '1024' ? 'R' : meta.EHTY === '512' ? 'S' : ''} (${meta.EHLV}階段)`
        : null;
    const energy = meta.IMEEL
        ? `聚能 等級 ${meta.IMEEL}/${meta.IMEEML ?? '?'}`
        : null;

    // 染色有兩組：Bin80 六色 = 目前顯示的顏色（套用外型時為外型的
    // 顏色）；metadata OIC1..6 = 原始物品顏色（-1 = 未染 = #FFFFFF）。
    const colorGroups: { label: string; colors: string[] }[] = [];
    if (h.colors?.length) {
        colorGroups.push({ label: meta.SICID ? '道具顏色（外型）' : '道具顏色', colors: h.colors });
    }
    const oic: string[] = [];
    for (let i = 1; i <= 6; i++) {
        const raw = meta[`OIC${i}`];
        if (raw === undefined) continue;
        const v = Number(raw);
        oic.push((v >>> 0 & 0xffffff).toString(16).padStart(6, '0'));
    }
    if (meta.SICID && oic.length) {
        colorGroups.push({ label: '道具顏色（原始）', colors: oic });
    }

    // 細緻工匠：顯示值 = (init + (level-1) × per) × standard，
    // IsFloat 補兩位小數，後綴 SubDesc（"m 增加" / "% 增加"）。
    const metalware: TipMetalware[] = (h.metalware ?? []).map(m => {
        const a = deps.metalwareMap[m.id];
        let text: string | null = null;
        if (a) {
            const v = (a.init + (m.level - 1) * a.per) * (a.standard || 1);
            text = `${a.isFloat ? v.toFixed(2) : Math.round(v)} ${a.subDesc}`;
        }
        return {
            name: a?.name ?? `#${m.id}`,
            level: m.level,
            max: a?.max || 20,
            value: text,
        };
    });

    if (!props.length && !enchants.length && !metalware.length && !bless.length
        && !imprint && !upgrades.length && !special && !energy && !relic.length
        && !relicDesc && !colorGroups.length) return null;
    return { props, imprint, enchants, bless, relic, relicDesc, upgrades, special, energy, metalware, colorGroups };
}

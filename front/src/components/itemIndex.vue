<template>
    <div class="pa-2">
        <div class="d-flex align-center mb-2" style="gap: 8px">
            <v-text-field v-model="query" label="物品名稱或 ID" hide-details density="compact" clearable
                style="max-width: 360px" />
            <v-btn :loading="loading" @click="reload">重新整理</v-btn>
            <span class="text-caption text-medium-emphasis">{{ entityCount }} 個實體 / {{ itemKindCount }} 種物品</span>
        </div>
        <v-data-table :headers="headers" :items="rows" density="compact" :items-per-page="50" />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, inject, onMounted, type Ref } from 'vue';
import { buildItemIndex, searchById, searchByName, type IndexEntity, type Holder } from '@/lib/itemIndex';

export default defineComponent({
    setup() {
        const itemNameMap = inject('itemNameMap') as Ref<Record<number, string>>;
        const enchantNameMap = inject('enchantNameMap') as Ref<Record<number, string>>;
        const query = ref('');
        const loading = ref(false);
        const idx = ref(new Map<number, Holder[]>());

        // itemNameMap 的值格式為「名稱 id」，這裡去掉結尾的 id 只留名稱。
        const itemName = (id: number): string => {
            const label = itemNameMap.value[id];
            if (!label) return `Item ${id}`;
            return label.replace(/\s*\d+$/, '');
        };

        // enchantText: 有賦予時顯示「接頭:名稱 / 接尾:名稱」；名稱表沒有該 id
        // （內嵌 db 還沒帶 optionset）時退回顯示數字 id。
        const enchantText = (h: Holder): string => {
            const label = (id: number) => enchantNameMap.value[id] ?? `${id}`;
            const parts: string[] = [];
            if (h.enchantPrefix) parts.push(`接頭:${label(h.enchantPrefix)}`);
            if (h.enchantSuffix) parts.push(`接尾:${label(h.enchantSuffix)}`);
            return parts.join(' / ');
        };

        // displayName: 仿遊戲命名——
        //   卷軸/魔法粉（給予賦予）：「魔力賦予卷軸 - 生命」（物品名 - 賦予名）
        //   裝備（已附加賦予）：「辛勤的 杜克獵人手套」（賦予名前置，接頭 接尾 物品名）
        const displayName = (h: Holder): string => {
            const label = (id: number) => enchantNameMap.value[id] ?? `${id}`;
            const parts: string[] = [];
            if (h.enchantPrefix) parts.push(label(h.enchantPrefix));
            if (h.enchantSuffix) parts.push(label(h.enchantSuffix));
            const base = itemName(h.id);
            if (!parts.length) return base;
            return /卷軸|魔法粉/.test(base)
                ? `${base} - ${parts.join(' - ')}`
                : `${parts.join(' ')} ${base}`;
        };

        // nameToIds: 回傳 label 含查詢字串的所有 item id（模糊比對）。
        const nameToIds = (name: string): number[] => {
            const n = name.trim().toLowerCase();
            if (!n) return [];
            const ids: number[] = [];
            for (const [id, label] of Object.entries(itemNameMap.value)) {
                if ((label ?? '').toLowerCase().includes(n)) ids.push(Number(id));
            }
            return ids;
        };

        const reload = async () => {
            loading.value = true;
            try {
                const data: IndexEntity[] = await (await fetch('/api/item-index')).json();
                idx.value = buildItemIndex(data);
            } catch (e) {
                console.error('item-index fetch failed', e);
            } finally {
                loading.value = false;
            }
        };

        const entityCount = computed(() => {
            const set = new Set<string>();
            for (const holders of idx.value.values()) for (const h of holders) set.add(h.entity);
            return set.size;
        });
        const itemKindCount = computed(() => idx.value.size);

        const allHolders = (): Holder[] => {
            const out: Holder[] = [];
            for (const holders of idx.value.values()) out.push(...holders);
            return out;
        };

        const rows = computed(() => {
            const q = query.value?.trim();
            const holders = !q
                ? allHolders()
                : /^\d+$/.test(q)
                    ? searchById(idx.value, Number(q))
                    : searchByName(idx.value, q, nameToIds);
            return holders.map(h => ({
                item: displayName(h),
                itemId: h.id,
                enchant: enchantText(h),
                entity: h.entity,
                master: h.master,
                container: h.container,
                qty: h.qty,
                pos: `(${h.x},${h.y})`,
            }));
        });

        const headers = [
            { title: '物品', key: 'item' },
            { title: '物品ID', key: 'itemId' },
            { title: '賦予', key: 'enchant' },
            { title: '角色', key: 'entity' },
            { title: 'Owner', key: 'master' },
            { title: '背包', key: 'container' },
            { title: '數量', key: 'qty' },
            { title: '座標', key: 'pos' },
        ];

        onMounted(reload);
        return { query, loading, reload, rows, headers, entityCount, itemKindCount };
    },
});
</script>

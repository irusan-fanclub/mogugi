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
        const query = ref('');
        const loading = ref(false);
        const idx = ref(new Map<number, Holder[]>());

        const itemName = (id: number): string => itemNameMap.value[id] ?? `Item ${id}`;

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
                item: itemName(h.id),
                entity: h.entity,
                master: h.master,
                container: h.container,
                qty: h.qty,
                pos: `(${h.x},${h.y})`,
            }));
        });

        const headers = [
            { title: '物品', key: 'item' },
            { title: '實體', key: 'entity' },
            { title: '飼主', key: 'master' },
            { title: '容器', key: 'container' },
            { title: '數量', key: 'qty' },
            { title: '座標', key: 'pos' },
        ];

        onMounted(reload);
        return { query, loading, reload, rows, headers, entityCount, itemKindCount };
    },
});
</script>

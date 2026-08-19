<template>
    <div class="pa-2">
        <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
            <v-select v-model="codeFilter" :items="codeOptions" item-title="title" item-value="value"
                label="副本" hide-details density="compact" clearable style="min-width: 160px; max-width: 240px" />
            <v-select v-model="tierFilter" :items="tierOptions" label="進入區域" hide-details
                density="compact" clearable style="min-width: 140px; max-width: 220px" />
            <v-select v-model="playerFilter" :items="playerOptions" label="角色" hide-details
                density="compact" clearable style="min-width: 140px; max-width: 220px" />
            <v-text-field v-model="fromInput" type="datetime-local" label="從" hide-details
                density="compact" clearable style="min-width: 200px" />
            <v-text-field v-model="toInput" type="datetime-local" label="到" hide-details
                density="compact" clearable style="min-width: 200px" />
            <v-btn :loading="loading" icon="mdi-refresh" size="small" variant="text"
                title="重新整理" @click="reload" />
            <span class="text-caption text-medium-emphasis">{{ rows.length }} / {{ battles.length }} 筆</span>
        </div>

        <v-sheet v-if="error" class="pa-6 text-medium-emphasis">
            {{ error }}
        </v-sheet>
        <v-sheet v-else-if="!loading && battles.length === 0" class="pa-6 text-medium-emphasis">
            目前沒有戰鬥紀錄，只有白名單內的副本會被記錄（舊版紀錄不會列在這裡）。
        </v-sheet>
        <template v-else>
        <v-table density="compact">
            <thead>
                <tr>
                    <th class="sortable" @click="toggleSort('startedAt')">開始時間 {{ sortMark('startedAt') }}</th>
                    <th>BOSS 名稱</th>
                    <th class="sortable" @click="toggleSort('duration')">戰鬥時間 {{ sortMark('duration') }}</th>
                    <th>通關</th>
                    <th>角色</th>
                    <th class="text-right sortable" @click="toggleSort('dps')">整場DPS {{ sortMark('dps') }}</th>
                    <th class="text-right">人數</th>
                    <th>秘法</th>
                    <th style="width: 190px;"></th>
                </tr>
            </thead>
            <tbody>
                <template v-for="v in pageRows" :key="v.key">
                <tr :title="v.file">
                    <td>{{ rowTime(v) }}</td>
                    <td>{{ v.bossName || '-' }}</td>
                    <td>{{ v.durationSec ? formatDuration(v.durationSec) : '-' }}</td>
                    <td>
                        <span v-if="v.cleared === true" style="color: #6c6;">✓</span>
                        <span v-else-if="v.cleared === false" style="color: #e66;">✗</span>
                        <span v-else>-</span>
                    </td>
                    <td>{{ v.player }}</td>
                    <td class="text-right text-no-wrap" :title="dpsTooltip(v)">
                        <span v-if="isPersonalBest(v)" title="這場是同 BOSS 的個人最佳">⭐</span>
                        {{ v.ownerDps ? humanReadableNumber(v.ownerDps) : '-' }}
                    </td>
                    <td class="text-right">{{ v.partySize || '-' }}</td>
                    <td>
                        <img v-if="v.ownerArcana" width="20" height="20" style="vertical-align: middle;"
                            :src="arcanaIconUrl(v.ownerArcana)" :title="arcanaTitle(v.ownerArcana)" />
                        <span v-else>-</span>
                    </td>
                    <td class="text-no-wrap actions">
                        <v-btn icon="mdi-chevron-down" size="small" variant="text"
                            :style="{ transform: expanded.has(v.key) ? 'rotate(180deg)' : '' }"
                            title="隊友與筆記" @click="toggleExpand(v.key)" />
                        <v-btn icon="mdi-folder-open" size="small" variant="text"
                            title="開啟檔案位置" @click="revealRecord(v.file)" />
                        <v-btn icon="mdi-chart-box" size="small" variant="text"
                            title="載入並切到傷害分析" :loading="loadingFile === v.file"
                            @click="loadRecord(v.file)" />
                        <v-btn v-if="confirmDelete !== v.file" icon="mdi-delete-outline" size="small" variant="text"
                            title="刪除（移到資源回收桶）" @click="askDelete(v.file)" />
                        <v-btn v-else icon="mdi-delete-alert" size="small" variant="tonal" color="error"
                            title="再按一次確認刪除（整個檔案，含同場其他王戰）" @click="doDelete(v.file)" />
                    </td>
                </tr>
                <tr v-if="expanded.has(v.key)">
                    <td :colspan="9" class="expand-cell">
                        <div class="d-flex flex-wrap" style="gap: 24px; padding: 8px 4px;">
                            <table v-if="v.players?.length" class="party-table">
                                <thead>
                                    <tr><th>隊友</th><th>秘法</th><th class="text-right">傷害</th><th class="text-right">DPS</th><th class="text-right">佔比</th></tr>
                                </thead>
                                <tbody>
                                    <tr v-for="pl in sortedPlayers(v)" :key="pl.EntityId">
                                        <td>{{ pl.Name }}</td>
                                        <td>
                                            <img v-if="pl.Arcana" width="18" height="18" style="vertical-align: middle;"
                                                :src="arcanaIconUrl(pl.Arcana)" :title="arcanaTitle(pl.Arcana)" />
                                            <span v-else>-</span>
                                        </td>
                                        <td class="text-right">{{ humanReadableNumber(pl.Damage) }}</td>
                                        <td class="text-right">{{ humanReadableNumber(pl.Dps) }}</td>
                                        <td class="text-right">{{ partyShare(v, pl) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <span v-else class="text-medium-emphasis">此紀錄沒有隊伍資料</span>
                            <div style="min-width: 260px; flex: 1; max-width: 420px;">
                                <v-textarea :model-value="noteDraft[v.file] ?? v.note ?? ''" label="筆記" rows="2"
                                    density="compact" variant="outlined" hide-details auto-grow
                                    @update:model-value="noteDraft[v.file] = $event" />
                                <v-btn size="small" variant="tonal" class="mt-1" prepend-icon="mdi-content-save"
                                    :disabled="(noteDraft[v.file] ?? v.note ?? '') === (v.note ?? '')"
                                    @click="saveNote(v)">儲存筆記</v-btn>
                            </div>
                        </div>
                    </td>
                </tr>
                </template>
            </tbody>
        </v-table>
        <div class="d-flex justify-center mt-2" v-if="pageCount > 1">
            <v-pagination v-model="page" :length="pageCount" density="compact" total-visible="7" />
        </div>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, inject } from 'vue';
import {
    filterBattles, humanReadableBytes, distinctOptions, toLocalRFC3339,
    formatStartedAt, dungeonDisplayName, type BattleRecord,
} from '@/lib/battleFilter';
import { humanReadableNumber, formatDuration, formatUnixLocal } from '@/lib/util';
import { arcanaIconUrl, arcanaTitle } from '@/lib/arcana';
import { sortBattles, personalStats, flattenBattles, type BattleSortKey, type BattlePlayer, type BattleRow } from '@/lib/battleFilter';

export default defineComponent({
    setup() {
        const battles = ref<BattleRecord[]>([]);
        // Starts true so the first frame shows loading, not the empty-state text.
        const loading = ref(true);
        const error = ref<string | null>(null);

        const codeFilter = ref<string | null>(null);
        const tierFilter = ref<string | null>(null);
        const playerFilter = ref<string | null>(null);
        // datetime-local text fields hold local wall-clock strings; converted
        // to RFC3339-with-offset only when filtering.
        const fromInput = ref<string | null>(null);
        const toInput = ref<string | null>(null);

        const reload = async () => {
            loading.value = true;
            error.value = null;
            try {
                const res = await fetch('/api/battles');
                if (!res.ok) {
                    battles.value = [];
                    error.value = '無法載入戰鬥紀錄，請稍後再試。';
                    return;
                }
                const data = await res.json();
                battles.value = data.battles ?? [];
            } catch (e) {
                console.error('battles fetch failed', e);
                battles.value = [];
                error.value = '無法載入戰鬥紀錄，請稍後再試。';
            } finally {
                loading.value = false;
            }
        };

        const codeOptions = computed(() => distinctOptions(battles.value, v => v.code)
            .map(code => ({ title: dungeonDisplayName(code), value: code })));
        const tierOptions = computed(() => distinctOptions(battles.value, v => v.tier));
        const playerOptions = computed(() => distinctOptions(battles.value, v => v.player));

        const sortKey = ref<BattleSortKey>('startedAt');
        const sortDir = ref<'asc' | 'desc'>('desc');
        const toggleSort = (key: BattleSortKey) => {
            if (sortKey.value === key) {
                sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
            } else {
                sortKey.value = key;
                sortDir.value = 'desc';
            }
        };
        const sortMark = (key: BattleSortKey) =>
            sortKey.value !== key ? '' : (sortDir.value === 'desc' ? '▼' : '▲');

        const rows = computed(() => sortBattles(flattenBattles(filterBattles(battles.value, {
            code: codeFilter.value ?? undefined,
            tier: tierFilter.value ?? undefined,
            player: playerFilter.value ?? undefined,
            from: toLocalRFC3339(fromInput.value),
            to: toLocalRFC3339(toInput.value),
        })), sortKey.value, sortDir.value));

        // Pagination keeps the DOM small once the history grows.
        const PAGE_SIZE = 50;
        const page = ref(1);
        const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));
        const pageRows = computed(() => {
            const p = Math.min(page.value, pageCount.value);
            return rows.value.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
        });

        // Personal best/average per player+boss over the whole history
        // (unfiltered, so the badge means "all-time best").
        const stats = computed(() => personalStats(flattenBattles(battles.value)));
        const statOf = (v: BattleRow) => stats.value.get(`${v.player}|${v.bossRace}`);
        const isPersonalBest = (v: BattleRow) => !!v.ownerDps && statOf(v)?.bestFile === v.key;
        const dpsTooltip = (v: BattleRow) => {
            const st = statOf(v);
            if (!st || !v.ownerDps) return v.file;
            return `同BOSS歷史：最佳 ${humanReadableNumber(st.best)} / 平均 ${humanReadableNumber(st.avg)}（${st.count} 場）`;
        };
        const rowTime = (v: BattleRow) =>
            v.fightStartAt ? formatUnixLocal(v.fightStartAt) : formatStartedAt(v.startedAtLocal);

        const expanded = ref(new Set<string>());
        const toggleExpand = (file: string) => {
            const next = new Set(expanded.value);
            if (next.has(file)) next.delete(file);
            else next.add(file);
            expanded.value = next;
        };
        const sortedPlayers = (v: BattleRow) =>
            [...(v.players ?? [])].sort((a, b) => b.Dps - a.Dps);
        const partyShare = (v: BattleRow, pl: BattlePlayer) => {
            const total = (v.players ?? []).reduce((s, p) => s + p.Damage, 0);
            return total > 0 ? `${(pl.Damage / total * 100).toFixed(1)}%` : '-';
        };

        const noteDraft = ref<Record<string, string>>({});
        const saveNote = async (v: BattleRow) => {
            const note = noteDraft.value[v.file] ?? v.note ?? '';
            try {
                const res = await fetch('/api/battles/note?file=' + encodeURIComponent(v.file), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note }),
                });
                if (!res.ok) throw new Error(String(res.status));
                const rec = battles.value.find(b => b.file === v.file);
                if (rec) rec.note = note;
            } catch (e) {
                console.error('save note failed', e);
                error.value = '筆記儲存失敗，請稍後再試。';
            }
        };

        // Two-step delete: first click arms the red confirm button, which
        // disarms itself after a few seconds.
        const confirmDelete = ref('');
        let confirmTimer: ReturnType<typeof setTimeout> | undefined;
        const askDelete = (file: string) => {
            confirmDelete.value = file;
            if (confirmTimer) clearTimeout(confirmTimer);
            confirmTimer = setTimeout(() => { confirmDelete.value = ''; }, 4000);
        };
        const doDelete = async (file: string) => {
            confirmDelete.value = '';
            try {
                const res = await fetch('/api/battles/delete?file=' + encodeURIComponent(file), { method: 'POST' });
                if (!res.ok) throw new Error(String(res.status));
                battles.value = battles.value.filter(b => b.file !== file);
            } catch (e) {
                console.error('delete failed', e);
                error.value = '刪除失敗，請稍後再試。';
            }
        };

        onMounted(reload);

        const loadBattleRecord = inject('loadBattleRecord') as (file: string) => Promise<void>;
        const loadingFile = ref('');
        const loadRecord = async (file: string) => {
            loadingFile.value = file;
            try {
                await loadBattleRecord(file);
            } catch (e) {
                console.error('load record failed', e);
                error.value = '載入紀錄失敗，請稍後再試。';
            } finally {
                loadingFile.value = '';
            }
        };

        const revealRecord = async (file: string) => {
            try {
                await fetch('/api/battles/reveal?file=' + encodeURIComponent(file), { method: 'POST' });
            } catch (e) {
                console.error('reveal failed', e);
            }
        };

        return {
            loadRecord, revealRecord, loadingFile,
            humanReadableNumber, formatDuration, arcanaIconUrl, arcanaTitle,
            sortKey, sortDir, toggleSort, sortMark,
            page, pageCount, pageRows,
            isPersonalBest, dpsTooltip, rowTime,
            expanded, toggleExpand, sortedPlayers, partyShare,
            noteDraft, saveNote,
            confirmDelete, askDelete, doDelete,
            battles, loading, error, reload, rows, humanReadableBytes, formatStartedAt, dungeonDisplayName,
            codeFilter, tierFilter, playerFilter, fromInput, toInput,
            codeOptions, tierOptions, playerOptions,
        };
    },
});
</script>

<style scoped>
.sortable {
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}

.actions {
    /* Real gaps between the row buttons - x-small glued together was
       unusable. */
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: none;
}

.expand-cell {
    background: rgba(255, 255, 255, 0.03);
}

.party-table {
    border-collapse: collapse;
    font-size: 0.85em;
}

.party-table th,
.party-table td {
    padding: 2px 12px;
    text-align: left;
}

.party-table .text-right {
    text-align: right;
}
</style>

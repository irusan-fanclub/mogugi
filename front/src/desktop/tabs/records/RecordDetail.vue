<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BattleRow } from '@/lib/battleFilter';
import { arcanaIconUrl, arcanaTitle } from '@/lib/arcana';
import { humanReadableNumber } from '@/lib/util';
import { partyShare, sortedPlayers } from '@/lib/battleRecordsView';
import DButton from '../../ui/DButton.vue';
import DTextarea from '../../ui/DTextarea.vue';

// Expanded row: party table and the per-file note.
const props = defineProps<{ row: BattleRow; draft?: string }>();
const emit = defineEmits<{ 'update:draft': [value: string]; save: [note: string] }>();

const players = computed(() => sortedPlayers(props.row));
const saved = computed(() => props.row.note ?? '');
const text = ref(props.draft ?? saved.value);
watch(() => props.draft, v => { if (v !== undefined && v !== text.value) text.value = v; });
watch(text, v => emit('update:draft', v));
const dirty = computed(() => text.value !== saved.value);
</script>

<template>
  <div class="detail">
    <table v-if="row.players?.length" class="party">
      <thead>
        <tr><th>隊友</th><th>秘法</th><th class="r">傷害</th><th class="r">DPS</th><th class="r">活躍 DPS</th><th class="r">佔比</th></tr>
      </thead>
      <tbody>
        <tr v-for="pl in players" :key="pl.EntityId">
          <td>{{ pl.Name }}</td>
          <td>
            <img v-if="pl.Arcana" width="18" height="18" :src="arcanaIconUrl(pl.Arcana)" :title="arcanaTitle(pl.Arcana)">
            <template v-else>-</template>
          </td>
          <td class="r">{{ humanReadableNumber(pl.Damage) }}</td>
          <td class="r">{{ humanReadableNumber(pl.Dps) }}</td>
          <td class="r">{{ pl.ActiveDps ? humanReadableNumber(pl.ActiveDps) : '-' }}</td>
          <td class="r">{{ partyShare(row, pl) }}</td>
        </tr>
      </tbody>
    </table>
    <span v-else class="dim">此紀錄沒有隊伍資料</span>
    <div class="note">
      <DTextarea v-model="text" :rows="2" placeholder="筆記" aria-label="筆記" />
      <DButton size="sm" data-save-note :disabled="!dirty" @click="emit('save', text)">儲存筆記</DButton>
    </div>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-wrap: wrap; gap: var(--space-5); padding: var(--space-3) var(--space-2); }
.party { border-collapse: collapse; font-size: var(--fs-sm); }
.party th, .party td { padding: var(--space-1) var(--space-4); text-align: left; }
.party th { color: var(--c-text-dim); font-weight: normal; }
.party .r { text-align: right; }
.party img { vertical-align: middle; }
.dim { color: var(--c-text-dim); }
.note { display: flex; flex-direction: column; gap: var(--space-2); min-width: 260px; flex: 1; max-width: 420px; }
</style>

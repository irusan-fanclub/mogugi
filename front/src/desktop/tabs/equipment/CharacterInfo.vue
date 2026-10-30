<script setup lang="ts">
import { computed } from 'vue';
import type { ownerPanel, ownerProfile } from '@/protocols';
import { buildCharacterInfo } from '@/lib/characterInfo';

const props = defineProps<{ name: string; panel: ownerPanel | null; profile: ownerProfile | null }>();
const rows = computed(() => buildCharacterInfo(props));
</script>

<template>
  <aside class="info" data-character-info>
    <div v-if="!rows" class="empty">換頻後會出現</div>
    <table v-else>
      <tbody>
        <template v-for="r in rows" :key="r.label">
          <tr data-info-row>
            <td class="lab">{{ r.label }}</td>
            <td class="val" :class="r.state" :data-state="r.state">{{ r.value }}</td>
          </tr>
          <tr v-if="r.missing" class="miss" data-info-missing>
            <td colspan="2">{{ r.missing }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </aside>
</template>

<style scoped>
.info { min-width: 240px; max-width: 320px; flex: 1 1 240px; }
table { width: 100%; border-collapse: collapse; }
td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--c-line); }
.lab { color: var(--c-text-dim); white-space: nowrap; }
.val { text-align: right; }
.val.ok, .val.short { font-family: var(--font-num); }
.val.ok { color: var(--c-ok); }
.val.short { color: var(--c-accent); }
.miss td { text-align: right; font-size: var(--fs-sm); color: var(--c-text-dim); border-bottom: 1px solid var(--c-line); }
.empty { font-size: var(--fs-sm); color: var(--c-text-dim); padding: var(--space-2) var(--space-3); }
</style>

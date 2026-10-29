<script setup lang="ts">
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DSelect, { type SelectItem } from '../../ui/DSelect.vue';
import { highlightParts } from '@/lib/highlight';

export type TargetItem = SelectItem & { boss?: boolean };

defineProps<{
    items: TargetItem[];
    hiddenCount: number;
    hasAlias: boolean;
    arcanaHidden: boolean;
    capturing?: boolean;
}>();
const target = defineModel<string>('target', { default: '' });
const bossOnly = defineModel<boolean>('bossOnly', { default: false });
const emit = defineEmits<{
    hideTarget: [id: string];
    restoreTargets: [];
    targetMenu: [e: MouseEvent, id: string];
    randomNames: [];
    restoreNames: [];
    toggleArcana: [];
    clear: [];
    settings: [];
    screenshot: [];
}>();
const ALIAS_HINT = '別名只存在本次執行，關閉後不保留';
</script>

<template>
  <div class="toolbar">
    <div class="line">
      <DSelect v-model="target" :items="items" class="target" placeholder="目標" menu-search>
        <template #item="{ item, query }">
          <div class="titem" @contextmenu="item.value && emit('targetMenu', $event, item.value)">
            <span class="ttl">
              <template v-for="(part, i) in highlightParts(item.title, query)" :key="i">
                <mark v-if="part.hit">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span v-if="(item as TargetItem).boss" class="boss-badge">BOSS</span>
            <button
              v-if="item.value"
              type="button"
              class="hide"
              data-hide-target
              title="隱藏這種怪（同種類一起隱藏）"
              aria-label="隱藏這種怪"
              @click="emit('hideTarget', item.value)"
            >
              <i class="mdi mdi-eye-off" />
            </button>
          </div>
        </template>
        <template #search-extra>
          <button type="button" class="boss-only" :class="{ on: bossOnly }" :aria-pressed="bossOnly" data-boss-only @mousedown.prevent @click="bossOnly = !bossOnly">只看 BOSS</button>
        </template>
        <template v-if="hiddenCount > 0" #footer>
          <div class="restore" @click="emit('restoreTargets')">已隱藏 {{ hiddenCount }} 種目標，點此恢復</div>
        </template>
      </DSelect>
      <span class="divider" />
      <DButton size="sm" :title="ALIAS_HINT" @click="emit('randomNames')">隨機名稱</DButton>
      <DButton size="sm" :title="ALIAS_HINT" :disabled="!hasAlias" @click="emit('restoreNames')">還原名稱</DButton>
      <DButton size="sm" title="隱藏所有玩家的秘法圖示" :active="arcanaHidden" @click="emit('toggleArcana')">{{ arcanaHidden ? '顯示秘法' : '隱藏秘法' }}</DButton>
      <span class="divider" />
      <DIconButton icon="mdi-camera" title="截圖" :disabled="capturing" @click="emit('screenshot')" />
      <DIconButton icon="mdi-cog" title="設定" @click="emit('settings')" />
      <DButton size="sm" variant="danger" title="清除戰鬥分頁的所有資料，含已載入的紀錄" data-clear-data @click="emit('clear')">清除資料</DButton>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-direction: column; gap: var(--space-3); padding-bottom: var(--space-3); }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); min-width: 0; }
.divider { flex: none; align-self: stretch; width: 1px; background: var(--c-line); }
.target { flex: 1; min-width: 150px; }
.titem { display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0; }
.ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.boss-badge {
    flex: none;
    padding: 0 var(--space-2);
    border: 1px solid var(--c-err);
    border-radius: var(--radius);
    color: var(--c-err);
    font-size: var(--fs-sm);
}
mark { background: transparent; color: var(--c-accent); }
.hide {
    display: inline-flex;
    flex: none;
    padding: 2px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text-dim);
    cursor: pointer;
}
.hide:hover { color: var(--c-text); background: var(--c-surface-2); }
.boss-only {
    flex: none;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text-dim);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
}
.boss-only:hover { color: var(--c-text); }
.boss-only.on { border-color: var(--c-accent); background: var(--c-accent); color: var(--c-bg-deep); }
.restore { padding: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); cursor: pointer; }
.restore:hover { background: var(--c-surface-2); color: var(--c-text); }
</style>

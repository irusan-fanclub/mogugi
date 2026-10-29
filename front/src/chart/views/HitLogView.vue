<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { ChartData, ChartOpts, ChartSpec } from '@/lib/chartProtocol';
import type { HitLogHit, HitLogPayload } from '@/desktop/windows/hitlogPayload';
import DVirtualList from '@/desktop/ui/DVirtualList.vue';
import DContextMenu from '@/desktop/ui/DContextMenu.vue';
import DToast from '@/desktop/ui/DToast.vue';
import { useContextMenu } from '@/desktop/ui/useContextMenu';
import { useToast } from '@/desktop/ui/useToast';

// The remaining view-contract props are unused here.
const props = defineProps<{ spec?: ChartSpec; data: ChartData | null; opts?: ChartOpts; range?: { min: number; max: number } | null }>();

/** Fixed row height; the virtual list depends on it. */
const ROW_HEIGHT = 64;

const payload = computed(() => props.data?.payload as HitLogPayload | undefined);
const list = ref<{ $el: HTMLElement; scrollToIndex(i: number): void }>();
let seeded = false;

// Open at the newest hit, then keep following while the user is at (or near) the bottom.
function nearBottom(): boolean {
    const el = list.value?.$el;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight <= ROW_HEIGHT * 2;
}
watch(() => payload.value?.hits, async hits => {
    if (!hits?.length) return;
    const follow = !seeded || nearBottom();
    seeded = true;
    if (!follow) return;
    await nextTick();
    list.value?.scrollToIndex(hits.length - 1);
}, { immediate: true, flush: 'pre' });

const ctx = useContextMenu();
const toast = useToast();

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.show('已複製');
    } catch {
        toast.show('複製失敗');
    }
}
function rowMenu(e: MouseEvent, h: HitLogHit) {
    ctx.open(e, [{ label: '複製技能與傷害', icon: 'mdi-content-copy', action: () => { void copy(`${h.skillName} ${h.damage}`); } }]);
}
</script>

<template>
  <div class="hitlog">
    <div class="head">{{ payload?.header ?? '' }}</div>
    <DVirtualList v-if="payload" ref="list" class="list" :items="payload.hits" :item-height="ROW_HEIGHT">
      <template #default="{ item }">
        <div class="hit" data-hit @contextmenu="rowMenu($event, item)">
          <img class="skill" :src="item.skillIcon" width="32" height="32" alt="">
          <div class="text">
            <div class="conds">
              <img
                v-for="c in item.cond" :key="`a${c.id}`" class="cc" data-cc :src="`/icons/cc/${c.id}.png`"
                width="16" height="16" :title="c.name" alt=""
              >
              <span class="arrow">-&gt;</span>
              <img
                v-for="c in item.targetCond" :key="`t${c.id}`" class="cc" data-cc :src="`/icons/cc/${c.id}.png`"
                width="16" height="16" :title="c.name" alt=""
              >
            </div>
            <div class="line">
              {{ item.skillName }} <span class="dmg">{{ item.damage }}</span>
              <span v-if="item.crit" class="crit">Critical</span>
              <span v-if="item.delayed" class="delayed">Additional Damage</span>
            </div>
          </div>
        </div>
      </template>
    </DVirtualList>
    <p v-else class="waiting">等待主視窗…</p>

    <DContextMenu />
    <DToast />
  </div>
</template>

<style scoped>
.hitlog { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.head { padding: var(--space-3); flex-shrink: 0; color: var(--c-text); }
.list { flex: 1; min-height: 0; }
.hit {
    display: flex; align-items: center; gap: var(--space-3); height: 100%; padding: 0 var(--space-3);
    border-bottom: 1px solid var(--c-line); box-sizing: border-box;
}
.skill { flex-shrink: 0; border-radius: 2px; }
.text { min-width: 0; }
.conds { display: flex; align-items: center; gap: 2px; min-height: 16px; }
.cc { cursor: default; }
.arrow { color: var(--c-text-dim); padding: 0 var(--space-2); }
.line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dmg { color: var(--c-number); }
.crit { color: var(--c-err); margin-left: var(--space-3); }
.delayed { color: var(--c-text-dim); margin-left: var(--space-3); }
.waiting { margin: auto; color: var(--c-text-dim); }
</style>

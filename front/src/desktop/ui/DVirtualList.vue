<script setup lang="ts" generic="T">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{
    items: T[];
    /** Fixed row height in px. */
    itemHeight: number;
    /** Fixed viewport height in px; omitted = fill the parent and follow its size. */
    height?: number;
    /** Extra rows rendered above and below the viewport. */
    overscan?: number;
}>(), { overscan: 4 });

defineSlots<{ default(p: { item: T; index: number }): unknown }>();

const el = ref<HTMLElement>();
const scrollTop = ref(0);
const measured = ref(0);
let ro: ResizeObserver | undefined;

const viewport = computed(() => props.height ?? measured.value);
const first = computed(() => Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - props.overscan));
const last = computed(() => Math.min(props.items.length,
    Math.ceil((scrollTop.value + viewport.value) / props.itemHeight) + props.overscan));
const rows = computed(() => {
    const out: { item: T; index: number }[] = [];
    for (let i = first.value; i < last.value; i++) out.push({ item: props.items[i], index: i });
    return out;
});

function onScroll() {
    if (el.value) scrollTop.value = el.value.scrollTop;
}

function scrollToIndex(i: number) {
    if (el.value) el.value.scrollTop = Math.max(0, i) * props.itemHeight;
    onScroll();
}

onMounted(() => {
    if (!el.value) return;
    measured.value = el.value.clientHeight;
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => { if (el.value) measured.value = el.value.clientHeight; });
        ro.observe(el.value);
    }
});
onBeforeUnmount(() => ro?.disconnect());

defineExpose({ scrollToIndex });
</script>

<template>
  <div
    ref="el"
    class="d-vlist"
    data-vlist
    :style="height !== undefined ? { height: height + 'px' } : undefined"
    @scroll.passive="onScroll"
  >
    <div class="spacer" data-vlist-spacer :style="{ height: items.length * itemHeight + 'px' }">
      <div
        v-for="r in rows"
        :key="r.index"
        class="row"
        data-vlist-row
        :style="{ top: r.index * itemHeight + 'px', height: itemHeight + 'px' }"
      >
        <slot :item="r.item" :index="r.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.d-vlist { overflow-y: auto; height: 100%; min-height: 0; scrollbar-gutter: stable; }
.spacer { position: relative; }
.row { position: absolute; left: 0; right: 0; overflow: hidden; }
</style>

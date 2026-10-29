<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { ChartSpec } from '@/lib/chartProtocol';
import TitleBar from '@/desktop/shell/TitleBar.vue';
import { useChartChannel } from './useChartChannel';
import { CHART_VIEWS } from './views';

const q = new URLSearchParams(location.search);
const queryTitle = q.get('title') ?? '';

function parse(): { id: string; spec: ChartSpec } | string {
    const id = q.get('id');
    const raw = q.get('spec');
    if (!id) return '圖表參數無效：缺少 id';
    if (!raw) return '圖表參數無效：缺少 spec';
    try {
        const spec = JSON.parse(raw) as ChartSpec;
        if (typeof spec !== 'object' || spec === null || typeof spec.kind !== 'string') return '圖表參數無效：spec 格式錯誤';
        return { id, spec };
    } catch {
        return '圖表參數無效：spec 格式錯誤';
    }
}

const parsed = parse();
const error = typeof parsed === 'string' ? parsed : '';
const spec = typeof parsed === 'string' ? null : parsed.spec;
// The channel exists only for valid parameters; an invalid window must send no hello.
const channel = typeof parsed === 'string' ? null : useChartChannel(parsed.id, parsed.spec);
const view = computed(() => (spec ? CHART_VIEWS[spec.kind] : undefined));
const title = computed(() => channel?.data.value?.title || queryTitle || 'mogugi');

onMounted(() => { document.title = title.value; });
watch(title, t => { document.title = t; });
</script>

<template>
  <div class="chart-app">
    <TitleBar variant="chart" :title="title" />
    <p v-if="error" class="msg" data-chart-error>{{ error }}</p>
    <p v-else-if="!view" class="msg" data-chart-error>不支援的圖表類型：{{ spec?.kind }}</p>
    <component
      :is="view"
      v-else-if="channel && spec"
      class="body"
      :spec="spec"
      :data="channel.data.value"
      :opts="channel.opts.value"
      :range="channel.range.value"
      @opts="channel.setOpts"
      @range="channel.sendRange"
    />
  </div>
</template>

<style scoped>
.chart-app { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.body { flex: 1; min-height: 0; }
.msg { margin: auto; color: var(--c-text-dim); }
</style>

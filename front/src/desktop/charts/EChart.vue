<script lang="ts">
import * as echarts from 'echarts/core';
import { BarChart, CustomChart, LineChart } from 'echarts/charts';
import {
    AxisPointerComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent,
    MarkAreaComponent, MarkLineComponent, TitleComponent, ToolboxComponent, TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
    BarChart, CustomChart, LineChart, AxisPointerComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent,
    MarkAreaComponent, MarkLineComponent, TitleComponent, ToolboxComponent, TooltipComponent, CanvasRenderer,
]);

export interface ZoomRange { startMs: number; endMs: number }

// Full-range dataZoom (0..100%) means "not zoomed".
export function zoomRangeOf(dz: { start?: number; end?: number; startValue?: unknown; endValue?: unknown } | undefined): ZoomRange | null {
    if (!dz) return null;
    if ((dz.start ?? 0) <= 0 && (dz.end ?? 100) >= 100) return null;
    if (typeof dz.startValue !== 'number' || typeof dz.endValue !== 'number') return null;
    return { startMs: dz.startValue, endMs: dz.endValue };
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';

const props = defineProps<{
    option: EChartsCoreOption;
    group?: string;
    // Changing this rebuilds with notMerge (series or grid layout changed).
    rebuildKey?: string;
    height?: number;
}>();
const emit = defineEmits<{ zoom: [range: ZoomRange | null]; legend: [selected: Record<string, boolean>] }>();

const el = ref<HTMLElement>();
let chart: echarts.ECharts | undefined;
let ro: ResizeObserver | undefined;
let silent = false;
let lastZoom: ZoomRange | null = null;

// Programmatic zoom changes must not echo back as user zoom events.
function dispatchSilently(payload: Record<string, unknown>) {
    silent = true;
    try { chart?.dispatchAction({ type: 'dataZoom', ...payload }); } finally { silent = false; }
}

function resetZoom() {
    lastZoom = null;
    dispatchSilently({ start: 0, end: 100 });
}

function apply(notMerge: boolean) {
    if (!chart) return;
    chart.setOption(props.option, { notMerge, lazyUpdate: true });
    // notMerge drops the zoom state; restore it so a rebuild does not unzoom the view.
    if (notMerge && lastZoom) dispatchSilently({ startValue: lastZoom.startMs, endValue: lastZoom.endMs });
}

onMounted(() => {
    if (!el.value) return;
    chart = echarts.init(el.value, null, { renderer: 'canvas' });
    if (props.group) {
        chart.group = props.group;
        echarts.connect(props.group);
    }
    chart.on('datazoom', () => {
        if (silent || !chart) return;
        const dz = (chart.getOption() as { dataZoom?: Parameters<typeof zoomRangeOf>[0][] }).dataZoom?.[0];
        lastZoom = zoomRangeOf(dz);
        emit('zoom', lastZoom);
    });
    chart.on('legendselectchanged', e => emit('legend', { ...(e as { selected: Record<string, boolean> }).selected }));
    apply(true);
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(el.value);
    }
});

watch(() => props.option, () => apply(false));
watch(() => props.rebuildKey, () => apply(true));

onBeforeUnmount(() => {
    ro?.disconnect();
    chart?.dispose();
    chart = undefined;
});

// The chart as it is now (zoom and legend included) drawn at another width, without the toolbox:
// screenshots lay out at a fixed width without resizing the live chart.
function snapshot(width: number, pixelRatio = 2): string | null {
    if (!chart || !el.value || width <= 0) return null;
    const off = echarts.init(document.createElement('div'), null, {
        renderer: 'canvas', width, height: el.value.clientHeight, devicePixelRatio: pixelRatio,
    });
    try {
        off.setOption(chart.getOption());
        off.setOption({ animation: false, toolbox: { show: false } });
        return off.getDataURL({ type: 'png', pixelRatio });
    } finally {
        off.dispose();
    }
}

defineExpose({ resetZoom, snapshot });
</script>

<template>
  <div ref="el" class="echart" data-shot-chart :style="{ height: height ? height + 'px' : '100%' }" />
</template>

<style scoped>
.echart { width: 100%; }
</style>

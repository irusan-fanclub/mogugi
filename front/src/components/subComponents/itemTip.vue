<template>
    <div class="item-tip">
        <div class="tip-title">{{ title }}</div>
        <template v-if="tip.imprint">
            <div class="tip-section">等級</div>
            <div class="tip-line tip-roll">{{ tip.imprint }}</div>
        </template>
        <template v-if="tip.props.length">
            <div class="tip-section">道具屬性</div>
            <div v-for="(l, i) in tip.props" :key="`p${i}`" class="tip-line">{{ l }}</div>
        </template>
        <template v-if="tip.bless.length">
            <div class="tip-section">聖水效果</div>
            <div v-for="(l, i) in tip.bless" :key="`b${i}`" class="tip-line tip-mw">{{ l }}</div>
        </template>
        <template v-if="tip.relic.length || tip.relicDesc">
            <div class="tip-section">遺物效果</div>
            <div v-for="(l, i) in tip.relic" :key="`r${i}`" class="tip-line tip-mw">{{ l }}</div>
            <div v-if="tip.relicDesc" class="tip-line tip-desc">{{ tip.relicDesc }}</div>
        </template>
        <template v-if="tip.magicCircle.length">
            <div class="tip-section">魔法陣效果</div>
            <div v-for="(l, i) in tip.magicCircle" :key="`mc${i}`" class="tip-line tip-mw">{{ l }}</div>
        </template>
        <template v-if="tip.enchants.length">
            <div class="tip-section">魔力賦予</div>
            <template v-for="(e, i) in tip.enchants" :key="`e${i}`">
                <div class="tip-line">
                    [{{ e.slot }}] {{ e.name }}<span v-if="e.rank" class="tip-rank">（等級 {{ e.rank }}）</span>
                </div>
                <div v-if="e.desc" class="tip-line tip-desc">{{ e.desc }}</div>
            </template>
        </template>
        <template v-if="tip.upgrades.length || tip.special">
            <div class="tip-section">改造</div>
            <div v-for="(u, i) in tip.upgrades" :key="`u${i}`" class="tip-line tip-mw">{{ u }}</div>
            <div v-if="tip.special" class="tip-line tip-roll">{{ tip.special }}</div>
        </template>
        <template v-if="tip.energy">
            <div class="tip-section">聚能</div>
            <div class="tip-line tip-mw">{{ tip.energy }}</div>
        </template>
        <template v-if="tip.metalware.length">
            <div class="tip-section">細緻工匠</div>
            <template v-for="(m, i) in tip.metalware" :key="`m${i}`">
                <div class="tip-line tip-mw">{{ m.name }} ({{ m.level }}/{{ m.max }}等級)</div>
                <div v-if="m.value != null" class="tip-line tip-desc">L {{ m.value }}</div>
            </template>
        </template>
        <template v-for="(g, gi) in tip.colorGroups" :key="`g${gi}`">
            <div class="tip-section">{{ g.label }}</div>
            <div v-for="(c, i) in g.colors" :key="`c${gi}-${i}`" class="tip-line">
                <span class="tip-swatch" :style="{ background: `#${c}` }" />
                部位 {{ 'ABCDEF'[i] }}
                <span class="tip-desc" style="padding-left:6px">#{{ c.toUpperCase() }}</span>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { Tip } from '@/lib/itemTooltip';

// Game-style item tooltip body; the caller wraps it in a v-tooltip with
// content-class="item-tip-content".
export default defineComponent({
    props: {
        title: { type: String, required: true },
        tip: { type: Object as PropType<Tip>, required: true },
    },
});
</script>

<style>
/* Game-style tooltip: dark panel with orange section headers. */
.item-tip-content {
    background: rgba(12, 12, 14, 0.96) !important;
    border: 1px solid #555;
    padding: 0 !important;
    max-width: 380px;
}

.item-tip {
    padding: 8px 12px;
    font-size: 0.85rem;
    color: #ddd;
}

.item-tip .tip-title {
    text-align: center;
    color: #fff;
    font-weight: bold;
    margin-bottom: 6px;
}

.item-tip .tip-section {
    display: inline-block;
    background: #7a4a00;
    color: #ffd27f;
    font-weight: bold;
    padding: 0 8px;
    border-radius: 2px;
    margin: 6px 0 3px;
}

.item-tip .tip-line {
    line-height: 1.5;
}

.item-tip .tip-rank {
    color: #8fd0ff;
}

.item-tip .tip-mw {
    color: #8fd0ff;
}

.item-tip .tip-desc {
    color: #aaa;
    padding-left: 10px;
    white-space: pre-line;
}

.item-tip .tip-roll {
    color: #ffe08a;
    padding-left: 10px;
}

.item-tip .tip-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1px solid #666;
    margin-right: 4px;
}
</style>

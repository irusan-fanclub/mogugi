<script setup lang="ts">
import type { Tip } from '@/lib/itemTooltip';

// Game-style item tooltip body. Props: `tip` (buildTip result), optional `title`.
// Wrap in <DTooltip bare> with this in the #content slot (items/equipment tabs).
defineProps<{ tip: Tip; title?: string }>();
</script>

<template>
  <div class="item-tip">
    <div v-if="title" class="tip-title">{{ title }}</div>
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
          [{{ e.slot }}] {{ e.name }}<span v-if="e.rank" class="tip-mw">（等級 {{ e.rank }}）</span>
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
        <span class="tip-desc tip-hex">#{{ c.toUpperCase() }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.item-tip {
    max-width: 380px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-tip-border);
    background: var(--c-tip-bg);
    color: var(--c-tip-text);
    font-size: var(--fs-md);
}
.tip-title { margin-bottom: 6px; text-align: center; color: var(--c-tip-title); font-weight: bold; }
.tip-section {
    display: inline-block;
    margin: 6px 0 3px;
    padding: 0 var(--space-3);
    border-radius: 2px;
    background: var(--c-tip-section-bg);
    color: var(--c-tip-section-text);
    font-weight: bold;
}
.tip-line { line-height: 1.5; }
.tip-mw { color: var(--c-tip-blue); }
.tip-desc { padding-left: 10px; color: var(--c-tip-desc); white-space: pre-line; }
.tip-roll { padding-left: 10px; color: var(--c-tip-roll); }
.tip-hex { padding-left: 6px; }
.tip-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: var(--space-2);
    border: 1px solid var(--c-tip-swatch-border);
}
</style>

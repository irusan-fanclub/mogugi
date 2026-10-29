<script setup lang="ts">
import { computed } from 'vue';
import { formatStartedAt, splitOwnerArcana, type BattleRow, type PersonalStat } from '@/lib/battleFilter';
import { arcanaIconUrl, arcanaTitle } from '@/lib/arcana';
import { formatDuration, formatUnixLocal, humanReadableNumber } from '@/lib/util';
import { musicIconUrl, musicTitle } from '@/lib/battleRecordsView';

// One table cell's content for a battle-record row, chosen by column key.
const props = defineProps<{ row: BattleRow; col: string; stat?: PersonalStat }>();

const split = computed(() => splitOwnerArcana(props.row.players ?? [], props.row.player));
const isBest = computed(() => !!props.row.ownerDps && props.stat?.bestFile === props.row.key);
const dpsTitle = computed(() => {
    const st = props.stat;
    if (!st || !props.row.ownerDps) return props.row.file;
    return `同BOSS歷史：最佳 ${humanReadableNumber(st.best)} / 平均 ${humanReadableNumber(st.avg)}（${st.count} 場）`;
});
const time = computed(() => props.row.fightStartAt
    ? formatUnixLocal(props.row.fightStartAt)
    : formatStartedAt(props.row.startedAtLocal));
</script>

<template>
  <span v-if="col === 'startedAt'">{{ time }}</span>
  <span v-else-if="col === 'bossName'">{{ row.bossName || '-' }}</span>
  <span v-else-if="col === 'duration'">{{ row.durationSec ? formatDuration(row.durationSec) : '-' }}</span>
  <span v-else-if="col === 'cleared'">
    <i v-if="row.cleared === true" class="mdi mdi-check ok" data-cleared="yes" />
    <i v-else-if="row.cleared === false" class="mdi mdi-close err" data-cleared="no" />
    <template v-else>-</template>
  </span>
  <span v-else-if="col === 'player'">{{ row.player }}</span>
  <span v-else-if="col === 'dps'" class="num nowrap" :title="dpsTitle">
    <i v-if="isBest" class="mdi mdi-star best" title="這場是同 BOSS 的個人最佳" data-best />
    {{ row.ownerDps ? humanReadableNumber(row.ownerDps) : '-' }}
  </span>
  <span v-else-if="col === 'activeDps'" class="num nowrap">
    {{ row.ownerActiveDps ? humanReadableNumber(row.ownerActiveDps) : '-' }}
  </span>
  <span v-else-if="col === 'partySize'">{{ row.partySize || '-' }}</span>
  <span v-else-if="col === 'arcana'" class="nowrap arcana">
    <template v-if="split.owner || split.teammates.length">
      <img
        v-if="split.owner" width="18" height="18"
        :src="arcanaIconUrl(split.owner.Arcana)"
        :title="`${arcanaTitle(split.owner.Arcana)}：${split.owner.Name}`"
      >
      <span v-if="split.owner && split.teammates.length" class="sep">|</span>
      <img
        v-for="pl in split.teammates" :key="pl.EntityId" width="18" height="18"
        :src="arcanaIconUrl(pl.Arcana)" :title="`${arcanaTitle(pl.Arcana)}：${pl.Name}`"
      >
    </template>
    <img v-else-if="row.ownerArcana" width="20" height="20" :src="arcanaIconUrl(row.ownerArcana)" :title="arcanaTitle(row.ownerArcana)">
    <template v-else>-</template>
  </span>
  <span v-else-if="col === 'client'">{{ row.client || '-' }}</span>
  <span v-else-if="col === 'music'" class="nowrap">
    <template v-if="row.musicCcId && row.musicPct">
      <img width="18" height="18" :src="musicIconUrl(row.musicCcId)" :title="musicTitle(row.musicCcId)">{{ row.musicPct.toFixed(1) }}%
    </template>
  </span>
</template>

<style scoped>
.nowrap { white-space: nowrap; }
.num { font-family: var(--font-num); color: var(--c-dps); }
.ok { color: var(--c-ok); }
.err { color: var(--c-err); }
.best { color: var(--c-number); }
img { vertical-align: middle; margin-right: 2px; }
.sep { margin: 0 var(--space-2); color: var(--c-text-dim); }
/* Room for 8 icons + separator so the column does not jump between pages. */
.arcana { display: inline-block; min-width: 176px; }
</style>

<template>
    <span class="buff-indicator" :title="tooltipText">
        <span v-if="isAbsent" class="buff-indicator__empty">—</span>
        <span v-else class="buff-indicator__cell" :style="{ opacity: cellOpacity }">
            <span class="buff-indicator__row">
                <span v-if="showSongChangeMark" class="buff-indicator__song-change">→</span>
                <img :src="iconUrl" width="16" height="16" class="buff-indicator__icon" />
                <span v-if="!compact" class="buff-indicator__value">
                    {{ valueText }}<span v-if="scope === 'self'" class="buff-indicator__self-mark">·</span>
                </span>
            </span>
        </span>
    </span>
</template>

<script lang="ts">
import { defineComponent, PropType, inject, computed, Ref } from 'vue';

import type { MusicBuffCell } from '@/lib/musicBuff';
import type { TrackScope } from '@/lib/buffTrack';
import { ccIconUrl, formatDuration } from '@/lib/util';

// One occupant of the per-player indicator zone (spec §1): presentation
// only, no derivation — `cell` already carries every field to render.
export default defineComponent({
    props: {
        cell: { type: Object as PropType<MusicBuffCell>, required: true },
        scope: { type: String as PropType<TrackScope>, required: true },
        compact: { type: Boolean, default: false },
        /** Fight-start second; the value ranges print relative to it. */
        origin: { type: Number, default: 0 },
    },
    setup(props) {
        const region = inject('region') as Ref<string>;

        const isAbsent = computed(() => props.cell.kind === 'absent');

        const iconUrl = computed(() =>
            props.cell.kind === 'present' ? ccIconUrl(region.value, props.cell.ccId) : '');

        const showSongChangeMark = computed(() =>
            props.cell.kind === 'present' && props.cell.songChanged);

        // Off-at-window-end dims the whole cell; an absent cell dims only
        // its own `—` glyph instead, handled separately in CSS.
        const cellOpacity = computed(() =>
            props.cell.kind === 'present' && !props.cell.isOn ? 0.45 : 1);

        // Each run prints its value with the span it was in force, on the
        // fight clock. One uninterrupted run needs no span at all, and from
        // the third performance on the display gives up counting.
        const rangeText = (r: [number, number]) =>
            `(${formatDuration(Math.max(0, r[0] - props.origin))}~${formatDuration(Math.max(0, r[1] - props.origin))})`;
        const runText = (r: { pct: number; range: [number, number] }) =>
            `${r.pct.toFixed(1)}%${rangeText(r.range)}`;
        const overplayed = computed(() =>
            props.cell.kind === 'present' && props.cell.runs.length >= 3);
        const valueText = computed(() => {
            if (props.cell.kind !== 'present') return '';
            const { runs, coverage } = props.cell;
            if (runs.length === 1) {
                return coverage >= 0.999 ? `${runs[0].pct.toFixed(1)}%` : runText(runs[0]);
            }
            const head = `${runText(runs[0])} -> ${runText(runs[1])}`;
            return runs.length === 2 ? head : `${head} ->😠`;
        });

        // Self-scope note applies even when absent (spec §10) — otherwise
        // "can't see it" would misread as "doesn't have it". Compact's value
        // note is present-cell only, since an absent cell has no value.
        const tooltipText = computed(() => {
            const parts: string[] = [];
            if (props.compact && props.cell.kind === 'present') parts.push(valueText.value);
            if (overplayed.value) parts.push('為什麼不續音樂、為什麼要死');
            if (props.scope === 'self') parts.push('只有自己看得到');
            return parts.length ? parts.join('，') : undefined;
        });

        return {
            isAbsent,
            iconUrl,
            showSongChangeMark,
            cellOpacity,
            valueText,
            tooltipText,
        };
    },
});
</script>

<style scoped>
.buff-indicator {
    /* Fixed width, left-aligned: every row's cell starts at the same x, so
       the column reads as a column instead of drifting per row. A flex box
       (not inline-block) so the contents centre on the row's own axis
       instead of riding the text baseline a few px high. */
    display: flex;
    align-items: center;
    width: 300px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
}

.buff-indicator__empty {
    opacity: 0.35;
}

.buff-indicator__cell {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    overflow: hidden;
    border-radius: 4px;
}

.buff-indicator__row {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    padding: 0 4px;
    width: 100%;
}

.buff-indicator__icon {
    border-radius: 2px;
    vertical-align: middle;
}

.buff-indicator__value {
    font-size: 0.85em;
}

.buff-indicator__self-mark {
    opacity: 0.7;
    margin-left: 2px;
}

/* During screenshot capture (ancestor class set by applyDamageBySkill) the
   fixed cell width lifts so long run text and the trailing mark render in
   full - html2canvas clips at the ellipsis boundary instead of drawing an
   ellipsis. */
.screenshot-capture .buff-indicator {
    width: max-content;
    max-width: none;
    overflow: visible;
    text-overflow: clip;
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref } from 'vue';
import type { Anchor } from '@/lib/overlayProtocol';

const props = defineProps<{
    id: string;
    name: string;
    left: number;
    top: number;
    width: number;
    anchor: Anchor;
    /** A ready CSS colour, e.g. rgba(). */
    bg: string;
    fontPx: number;
    editing: boolean;
    enabled: boolean;
    sample: boolean;
    clamped: boolean;
    dragging: boolean;
    docked?: boolean;
    dockTarget?: boolean;
    /** Shows the 「↩ 收回」 button of a unit frame. */
    back?: boolean;
}>();
const emit = defineEmits<{
    down: [e: PointerEvent, mode: 'move' | 'width'];
    move: [e: PointerEvent];
    up: [e: PointerEvent];
    cancel: [e: PointerEvent];
    anchor: [];
    toggle: [];
    undock: [];
    height: [h: number];
    back: [];
}>();

const el = ref<HTMLElement | null>(null);
let ro: ResizeObserver | undefined;

const measure = () => { if (el.value) emit('height', el.value.offsetHeight); };
onMounted(() => {
    measure();
    if (el.value && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(measure);
        ro.observe(el.value);
    }
});
onUpdated(measure);
onBeforeUnmount(() => ro?.disconnect());

const GLYPH: Record<Anchor, string> = { tl: '↖', tr: '↗', bl: '↙', br: '↘', center: '◎' };
const NAME: Record<Anchor, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下', center: '中心' };

function down(e: PointerEvent, mode: 'move' | 'width') {
    if (!props.editing || e.button !== 0) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    try { el.value?.setPointerCapture?.(e.pointerId); } catch { /* the drag still works without capture */ }
    emit('down', e, mode);
}

const handleLeft = () => !props.docked && (props.anchor === 'tr' || props.anchor === 'br');
const badgePos = () => props.docked
    ? { left: 'calc(var(--ov-badge) / -2)', top: 'calc(var(--ov-badge) / -2)' }
    : props.anchor === 'center'
    ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    : {
        [props.anchor[1] === 'l' ? 'left' : 'right']: 'calc(var(--ov-badge) / -2)',
        [props.anchor[0] === 't' ? 'top' : 'bottom']: 'calc(var(--ov-badge) / -2)',
    };
</script>

<template>
  <div
    ref="el"
    class="ov-frame"
    :class="{ editing, off: !enabled, clamped: clamped && !dragging, dragging, docked, 'dock-target': dockTarget }"
    :data-component="id"
    :style="{
      left: left + 'px', top: top + 'px', width: width + 'px',
      fontSize: fontPx + 'px',
      background: bg,
      pointerEvents: editing ? 'auto' : 'none',
    }"
    @pointerdown="down($event, 'move')"
    @pointermove="emit('move', $event)"
    @pointerup="emit('up', $event)"
    @pointercancel="emit('cancel', $event)"
  >
    <slot />
    <template v-if="editing">
      <span v-if="sample" class="ov-sample">範例</span>
      <div class="ov-tag" data-tag>
        <span>{{ name }}</span><i>{{ docked ? '黏合' : NAME[anchor] }}{{ enabled ? '' : '・已關閉' }}</i>
        <button
          v-if="back" type="button" class="ov-back" data-back title="收回"
          @pointerdown.stop @click.stop="emit('back')"
        >↩ 收回</button>
        <button
          type="button" class="ov-switch" :class="{ on: enabled }" data-toggle
          :title="enabled ? '關閉' : '開啟'" @pointerdown.stop @click.stop="emit('toggle')"
        />
      </div>
      <button
        v-if="docked" type="button" class="ov-badge" data-undock title="解除黏合" :style="badgePos()"
        @pointerdown.stop @click.stop="emit('undock')"
      >⛓</button>
      <button
        v-else type="button" class="ov-badge" data-anchor-badge title="切換錨點" :style="badgePos()"
        @pointerdown.stop @click.stop="emit('anchor')"
      >{{ GLYPH[anchor] }}</button>
      <div
        class="ov-handle" data-handle :data-side="handleLeft() ? 'left' : 'right'" title="拉寬"
        :style="handleLeft() ? { left: 'calc(var(--ov-handle-w) / -2)' } : { right: 'calc(var(--ov-handle-w) / -2)' }"
        @pointerdown="down($event, 'width')"
      />
    </template>
  </div>
</template>

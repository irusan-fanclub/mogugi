<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue';
import { ref, watch } from 'vue';

const props = defineProps<{
    min?: number;
    max?: number;
    error?: string;
    hint?: string;
    disabled?: boolean;
}>();
const model = defineModel<number>({ required: true });
const text = ref(String(model.value));

watch(model, v => { text.value = String(v); });

// Commit on blur/Enter: parse, clamp to [min,max], fall back to the old value on NaN.
function commit() {
    let n = Number(text.value);
    if (text.value.trim() === '' || !Number.isFinite(n)) n = model.value;
    if (props.min !== undefined && n < props.min) n = props.min;
    if (props.max !== undefined && n > props.max) n = props.max;
    text.value = String(n);
    model.value = n;
}

defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const msgId = useId();
// class/style stay on the wrapper; everything else goes to the control.
const inputAttrs = computed(() => {
    const { class: _c, style: _s, ...rest } = attrs;
    return rest;
});
</script>

<template>
  <div class="d-number" :class="[$attrs.class, { invalid: !!error }]" :style="$attrs.style as any">
    <input
      v-bind="inputAttrs"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error || hint ? msgId : undefined"
      v-model="text"
      class="inp"
      inputmode="decimal"
      :disabled="disabled"
      @blur="commit"
      @keydown.enter="commit"
    >
    <div v-if="error || hint" :id="msgId" class="msg" :class="{ err: !!error }">{{ error || hint }}</div>
  </div>
</template>

<style scoped>
.d-number { display: flex; flex-direction: column; gap: var(--space-2); }
.inp {
    height: var(--row-h);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    outline: 0;
    background: var(--c-bg-deep);
    color: var(--c-number);
    font-family: var(--font-num);
    font-size: var(--fs-md);
    text-align: right;
}
.inp:focus { border-color: var(--c-accent); }
.inp:disabled { opacity: 0.45; }
.invalid .inp { border-color: var(--c-err); }
.msg { font-size: var(--fs-xs); color: var(--c-text-dim); }
.msg.err { color: var(--c-err); }
</style>

<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue';
const model = defineModel<string>({ default: '' });
withDefaults(defineProps<{
    clearable?: boolean;
    error?: string;
    hint?: string;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
}>(), { type: 'text' });

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
  <div class="d-field" :class="[$attrs.class, { invalid: !!error }]" :style="$attrs.style as any">
    <div class="box">
      <input
        v-bind="inputAttrs"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error || hint ? msgId : undefined"
        v-model="model"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        spellcheck="false"
      >
      <button
        v-if="clearable && model"
        type="button"
        class="clear"
        data-clear
        tabindex="-1"
        aria-label="clear"
        @click="model = ''"
      >
        <i class="mdi mdi-close" />
      </button>
    </div>
    <div v-if="error || hint" :id="msgId" class="msg" :class="{ err: !!error }">{{ error || hint }}</div>
  </div>
</template>

<style scoped>
.d-field { display: flex; flex-direction: column; gap: var(--space-2); }
.box {
    display: flex;
    align-items: center;
    height: var(--row-h);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
}
.box:focus-within { border-color: var(--c-accent); }
.invalid .box { border-color: var(--c-err); }
input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-3);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
}
input::placeholder { color: var(--c-text-dim); }
input:disabled { opacity: 0.45; }
.clear {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-3);
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    cursor: pointer;
}
.clear:hover { color: var(--c-text); }
.msg { font-size: var(--fs-xs); color: var(--c-text-dim); }
.msg.err { color: var(--c-err); }
</style>

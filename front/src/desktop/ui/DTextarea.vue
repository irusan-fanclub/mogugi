<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue';
import { nextTick, onMounted, ref, watch } from 'vue';

const model = defineModel<string>({ default: '' });
withDefaults(defineProps<{
    rows?: number;
    placeholder?: string;
    error?: string;
    hint?: string;
    disabled?: boolean;
}>(), { rows: 2 });
const el = ref<HTMLTextAreaElement>();

function grow() {
    const t = el.value;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
}
watch(model, () => nextTick(grow));
onMounted(grow);

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
  <div class="d-textarea" :class="[$attrs.class, { invalid: !!error }]" :style="$attrs.style as any">
    <textarea
      v-bind="inputAttrs"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error || hint ? msgId : undefined"
      ref="el"
      v-model="model"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      spellcheck="false"
    />
    <div v-if="error || hint" :id="msgId" class="msg" :class="{ err: !!error }">{{ error || hint }}</div>
  </div>
</template>

<style scoped>
.d-textarea { display: flex; flex-direction: column; gap: var(--space-2); }
textarea {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    outline: 0;
    background: var(--c-bg-deep);
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
    resize: none;
    overflow: hidden;
}
textarea:focus { border-color: var(--c-accent); }
textarea:disabled { opacity: 0.45; }
.invalid textarea { border-color: var(--c-err); }
.msg { font-size: var(--fs-xs); color: var(--c-text-dim); }
.msg.err { color: var(--c-err); }
</style>

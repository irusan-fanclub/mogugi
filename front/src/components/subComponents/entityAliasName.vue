<template>
    <span class="d-inline-flex align-center" style="gap: 2px;"
        @click.stop @pointerdown.stop>
        <v-text-field v-if="editing" ref="field" v-model="draft" density="compact"
            hide-details variant="outlined" style="max-width: 160px;"
            @keyup.enter="commit" @keyup.esc="cancel" @blur="commit" />
        <template v-else>
            <span class="font-weight-medium">{{ displayName }}</span>
            <v-btn icon="mdi-pencil" size="x-small" variant="text" density="compact"
                title="改名" @click="startEdit" />
            <v-btn icon="mdi-dice-5" size="x-small" variant="text" density="compact"
                title="隨機別名" @click="onRandom" />
        </template>
    </span>
</template>

<script lang="ts">
import { defineComponent, ref, nextTick, type PropType } from 'vue';
import { setAlias, randomAlias } from '@/lib/entityAlias';

export default defineComponent({
    props: {
        realName: { type: String, required: true },
        displayName: { type: String, required: true },
        // The roster on screen, so a re-roll cannot land on someone else's
        // still-unaliased real name.
        knownRealNames: { type: Array as PropType<string[]>, default: () => [] },
    },
    setup(props) {
        const editing = ref(false);
        const draft = ref('');
        const field = ref<HTMLElement>();

        const startEdit = async () => {
            draft.value = props.displayName;
            editing.value = true;
            await nextTick();
            (field.value as unknown as { focus?: () => void })?.focus?.();
        };

        const commit = () => {
            if (!editing.value) return;
            editing.value = false;
            setAlias(props.realName, draft.value);
        };

        const cancel = () => { editing.value = false; };

        const onRandom = () => randomAlias(props.realName, [...props.knownRealNames]);

        return { editing, draft, field, startEdit, commit, cancel, onRandom };
    },
});
</script>

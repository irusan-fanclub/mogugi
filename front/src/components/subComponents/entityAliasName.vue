<template>
    <span class="d-inline-flex align-center entity-alias__wrap" style="gap: 2px;"
        @click.stop @pointerdown.stop>
        <template v-if="editing">
            <v-text-field ref="field" v-model="draft" density="compact" class="entity-alias__field"
                hide-details variant="outlined"
                @keyup.enter="commit" @keyup.esc="cancel" @blur="commit" />
            <!-- mousedown is swallowed so the field never blurs: blur would
                 commit and unmount this button before its click landed. -->
            <v-btn icon="mdi-check" size="x-small" variant="text" density="compact"
                title="套用" @mousedown.prevent @click="commit" />
        </template>
        <template v-else>
            <span class="font-weight-medium entity-alias__name" :title="displayName">{{ displayName }}</span>
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

        // Reached from three places (enter, blur, the check button); the guard
        // is what keeps a blur-then-click from committing twice.
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

<style scoped>
/* Width comes from the longest name on screen (--pc-name-width), so every
   row's buttons share an x. Longer names stay readable via the title. */
.entity-alias__name {
    display: inline-block;
    width: var(--pc-name-width, 6em);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
    /* The panel title forces 0.9375rem; the skill rows below inherit 1rem, and
       the two names read as different sizes without this. */
    font-size: 1rem;
}

/* Editing swaps two 24px buttons for one, so the field reclaims exactly that
   much and the columns to its right keep their x. */
.entity-alias__field {
    width: calc(var(--pc-name-width, 6em) + 26px);
    min-width: 140px;
}

/* Vuetify's compact field still reserves ~40px of control height, which made
   the whole row grow the moment a name went into edit. */
.entity-alias__field :deep(.v-input__control),
.entity-alias__field :deep(.v-field),
.entity-alias__field :deep(.v-field__input) {
    min-height: 24px;
}

.entity-alias__field :deep(.v-field__input) {
    padding-top: 0;
    padding-bottom: 0;
    font-size: 1rem;
}
</style>

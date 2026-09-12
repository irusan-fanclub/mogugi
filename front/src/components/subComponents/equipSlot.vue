<template>
    <v-sheet class="eq-slot" :class="{ 'eq-empty': !entry, 'eq-tall': tall }" border rounded>
        <v-tooltip v-if="entry?.tip" activator="parent" location="bottom"
            content-class="item-tip-content" :open-delay="150">
            <item-tip :title="entry.name" :tip="entry.tip" />
        </v-tooltip>
        <div class="eq-label">
            <span>{{ label }}</span>
            <span v-if="set" class="eq-sets">
                <span v-for="v in SETS" :key="v" class="eq-set" :class="{ 'eq-set-on': set === v }"
                    @click.stop="$emit('select-set', v)">{{ v }}</span>
            </span>
        </div>
        <template v-if="entry">
            <div class="eq-icon" :style="iconStyle(entry.item.id)" />
            <div class="eq-name">{{ entry.name }}</div>
            <div class="eq-brief">{{ entry.brief }}</div>
        </template>
        <div v-else class="eq-none">無</div>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { SlotEntry, WeaponSet } from '@/lib/equipStats';
import ItemTip from './itemTip.vue';

// One worn-gear cell of the 裝備分析 board; `set` renders the in-game
// I/II weapon-set toggle and emits select-set when the user clicks it.
export default defineComponent({
    components: { ItemTip },
    props: {
        label: { type: String, required: true },
        entry: { type: Object as PropType<SlotEntry | undefined>, default: undefined },
        tall: { type: Boolean, default: false },
        set: { type: String as PropType<WeaponSet | undefined>, default: undefined },
    },
    emits: {
        'select-set': (v: WeaponSet) => v === 'I' || v === 'II',
    },
    setup() {
        const SETS: WeaponSet[] = ['I', 'II'];
        const iconStyle = (id: number) => ({ background: `url("/icons/item/${id}.png") no-repeat center` });
        return { SETS, iconStyle };
    },
});
</script>

<style scoped>
.eq-slot { width: 128px; min-height: 120px; padding: 6px; cursor: help; }
.eq-tall { min-height: 200px; }
.eq-empty { opacity: 0.5; cursor: default; }
.eq-label { display: flex; justify-content: space-between; font-size: 0.75rem; color: #999; }
.eq-sets { display: inline-flex; gap: 2px; }
.eq-set { padding: 0 5px; border: 1px solid #555; border-radius: 2px; cursor: pointer; color: #777; line-height: 1.2; }
.eq-set-on { color: #fff; border-color: #ffd27f; background: #7a4a00; }
.eq-icon { width: 48px; height: 48px; margin: 2px auto; }
.eq-name { font-size: 0.8rem; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eq-brief { font-size: 0.7rem; color: #8fd0ff; text-align: center; }
.eq-none { text-align: center; color: #777; padding-top: 24px; }
</style>

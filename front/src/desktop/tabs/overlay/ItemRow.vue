<script setup lang="ts">
import DSwitch from '../../ui/DSwitch.vue';
import IconButton from './IconButton.vue';

// One item of a section list: the head row, and its own settings when open.
defineProps<{ itemKey: string; icon: string; name: string; solo: boolean; enabled: boolean; open: boolean }>();
const emit = defineEmits<{ toggle: []; reset: []; remove: []; recall: []; 'update:enabled': [v: boolean] }>();
</script>

<template>
  <div class="ovs-unit" :data-item="itemKey">
    <div class="head" @click="emit('toggle')">
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <img :src="icon" alt="">
      <span class="nm">{{ name }}</span>
      <span v-if="solo" class="ovs-solo" data-solo>單獨擺放<button type="button" @click.stop="emit('recall')">↩ 收回</button></span>
      <IconButton kind="reset" data-reset @fire="emit('reset')" />
      <IconButton kind="remove" data-remove @fire="emit('remove')" />
      <span @click.stop><DSwitch :model-value="enabled" @update:model-value="v => emit('update:enabled', v)" /></span>
    </div>
    <div v-if="open" class="body"><slot /></div>
  </div>
</template>

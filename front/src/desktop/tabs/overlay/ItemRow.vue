<script setup lang="ts">
import DSwitch from '../../ui/DSwitch.vue';
import IconButton from './IconButton.vue';

// One item of a section list: the head row, and its own settings when open.
defineProps<{ itemKey: string; icon: string; name: string; enabled: boolean; open: boolean }>();
const emit = defineEmits<{ toggle: []; reset: []; remove: []; 'update:enabled': [v: boolean] }>();
</script>

<template>
  <div class="ovs-unit" :data-item="itemKey">
    <div class="head" @click="emit('toggle')">
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <img :src="icon" alt="">
      <span class="nm">{{ name }}</span>
      <slot name="move" />
      <IconButton kind="reset" data-reset @fire="emit('reset')" />
      <IconButton kind="remove" data-remove @fire="emit('remove')" />
      <span @click.stop><DSwitch :model-value="enabled" @update:model-value="v => emit('update:enabled', v)" /></span>
    </div>
    <div v-if="open" class="body"><slot /></div>
  </div>
</template>

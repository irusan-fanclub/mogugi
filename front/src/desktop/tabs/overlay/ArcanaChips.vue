<script setup lang="ts">
import { ARCANA_NAMES } from '@/lib/arcanaTable';

// Empty = 不限.
const model = defineModel<number[]>({ required: true });
const ARCANA = Object.entries(ARCANA_NAMES).map(([id, name]) => ({ id: Number(id), name }));
const toggle = (id: number) => {
    model.value = model.value.includes(id) ? model.value.filter(x => x !== id) : [...model.value, id].sort((a, b) => a - b);
};
</script>

<template>
  <span class="ovs-chips" data-arcana>
    <button type="button" :class="{ on: model.length === 0 }" data-arcana-any @click="model = []">不限</button>
    <button
      v-for="a in ARCANA" :key="a.id" type="button" :class="{ on: model.includes(a.id) }" :data-arcana-id="a.id"
      @click="toggle(a.id)"
    >
      {{ a.name }}
    </button>
  </span>
</template>

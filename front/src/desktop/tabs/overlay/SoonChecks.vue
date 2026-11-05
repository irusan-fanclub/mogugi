<script setup lang="ts">
import DCheckbox from '../../ui/DCheckbox.vue';
</script>

<template>
  <!-- Text and voice reminders are not out yet: shown, never stored. -->
  <span v-for="l in ['文字', '語音']" :key="l" class="ovs-soon" title="尚未開放" data-soon>
    <DCheckbox :label="l" disabled />
  </span>
</template>

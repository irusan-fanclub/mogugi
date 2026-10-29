<script setup lang="ts">
import { computed } from 'vue';
import { formatRemaining, type CcOverlayVM, type CcRowVM } from '@/lib/overlayModel';
import { ICON_PX, type CcOverlaySettings } from '@/lib/overlaySettings';
import { ccIconUrl } from '@/lib/util';

const props = defineProps<{ vm: CcOverlayVM; settings: CcOverlaySettings }>();

const px = computed(() => ICON_PX[props.settings.iconSize]);
const sections = computed((): { key: string; title: string; rows: CcRowVM[] }[] => [
    { key: 'boss', title: 'BOSS', rows: props.vm.boss ? [props.vm.boss] : [] },
    { key: 'self', title: '自身', rows: props.vm.self ? [props.vm.self] : [] },
    { key: 'party', title: '隊友', rows: props.vm.party },
].filter(s => s.rows.length));
</script>

<template>
  <div class="ov-cc">
    <template v-for="s in sections" :key="s.key">
      <div class="ov-sec-title" :data-section="s.key">{{ s.title }}</div>
      <div v-for="r in s.rows" :key="r.id" class="ov-cc-row" data-cc-row>
        <span class="ov-name">{{ r.name }}</span>
        <div class="ov-icons">
          <div
            v-for="ic in r.icons" :key="ic.ccId" class="ov-icon" :class="{ expiring: ic.expiring }"
            :style="{ width: px + 'px', height: px + 'px' }" data-icon
          >
            <img :src="ccIconUrl('', ic.ccId)" alt="" draggable="false">
            <span v-if="ic.remaining !== null" class="ov-sec">{{ formatRemaining(ic.remaining) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

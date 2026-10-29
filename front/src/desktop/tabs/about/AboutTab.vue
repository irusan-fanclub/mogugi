<script setup lang="ts">
import DiscordIcon from '../../ui/DiscordIcon.vue';
import { ref } from 'vue';
import { copyWithFallback } from '@/lib/captureStatus';
import DButton from '../../ui/DButton.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';

const version = __APP_VERSION__;
const DISCORD_URL = 'https://discord.gg/pJQsN4HgsD';
const ctx = useContextMenu();
const toast = useToast();

async function copy(text: string) {
    toast.show(await copyWithFallback(text) === 'copied' ? '已複製' : '複製失敗');
}
const discordCopied = ref(false);
async function shareDiscord() {
    if (await copyWithFallback(DISCORD_URL) === 'copied') {
        discordCopied.value = true;
        setTimeout(() => { discordCopied.value = false; }, 2000);
    } else toast.show('複製失敗');
}
function versionMenu(e: MouseEvent) {
    ctx.open(e, [{ label: '複製版本', action: () => copy(`mogugi v${version}`) }]);
}
function discordMenu(e: MouseEvent) {
    ctx.open(e, [{ label: '複製 Discord 連結', action: () => copy(DISCORD_URL) }]);
}
</script>

<template>
  <div class="about-tab">
    <section class="about" data-about>
      <h2>關於</h2>
      <div class="title" data-version @contextmenu="versionMenu">
        mogugi <span class="ver">v{{ version }}</span>
      </div>

      <div class="credit">
        <div class="lang">中文</div>
        <p>本專案 fork 自 <strong>prilus/dilmatulgi</strong>，並在其基礎上進行二次開發。</p>
        <p class="dim">在此感謝原作者 prilus。</p>
      </div>
      <div class="credit">
        <div class="lang">English</div>
        <p>This project is forked from <strong>prilus/dilmatulgi</strong> and further developed on top of it.</p>
        <p class="dim">Thanks to the original author, prilus.</p>
      </div>

      <div class="row" @contextmenu="discordMenu">
        <DButton data-discord :title="DISCORD_URL" @click="shareDiscord">
          <DiscordIcon />
          {{ discordCopied ? '已複製連結' : '分享 Discord 連結' }}
        </DButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.about-tab { height: 100%; overflow-y: auto; padding: var(--space-4) var(--space-5); scrollbar-gutter: stable; }
.about { max-width: 640px; }
.about h2 { margin: 0 0 var(--space-3); font-size: var(--fs-lg); }
.title { margin-bottom: var(--space-4); font-size: var(--fs-lg); }
.ver { color: var(--c-text-dim); font-size: var(--fs-sm); }
.credit { margin-bottom: var(--space-4); font-size: var(--fs-md); }
.credit p { margin: var(--space-2) 0; }
.lang { color: var(--c-text-dim); font-size: var(--fs-sm); }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); }
.row { margin-top: var(--space-3); }
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import OverlayApp from '../overlay/OverlayApp.vue';
import OverlayTab from '../desktop/tabs/overlay/OverlayTab.vue';
import TitleBar from '../desktop/shell/TitleBar.vue';
import TabBar from '../desktop/shell/TabBar.vue';
import { useOverlayState } from '../desktop/overlay/useOverlayState';
import { emitDesktop } from '@/lib/desktopBridge';
import { pushState, scenario } from './fakeBridge';
import { inBattle } from './fakeOverlayData';

type View = 'edit' | 'overlay' | 'window';
const VIEWS: { id: View; label: string }[] = [
    { id: 'edit', label: '遊戲內排版編輯' },
    { id: 'overlay', label: '遊戲內 overlay' },
    { id: 'window', label: 'mogugi 視窗' },
];
const GAME = { w: 1280, h: 720 };
const WIN = { w: 1000, h: 720 };

const fromHash = (): View => {
    const h = location.hash.slice(1);
    return h === 'overlay' || h === 'window' ? h : 'edit';
};
const view = ref<View>(fromHash());
const onHash = () => { view.value = fromHash(); };

const { state } = useOverlayState();

// The two game views are the same overlay, unlocked or locked.
watch(view, v => {
    if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
    if (v !== 'window') void emitDesktop('overlay:set-locked', { locked: v === 'overlay' });
}, { immediate: true });
watch(() => state.value?.locked, l => {
    if (l === false && view.value === 'overlay') view.value = 'edit';
    if (l === true && view.value === 'edit') view.value = 'overlay';
});
watch(scenario, () => pushState(), { deep: true });

const avail = ref(GAME.w);
let ro: ResizeObserver | undefined;
onMounted(() => {
    window.addEventListener('hashchange', onHash);
    // The page width, not the body's: the scaled box must not feed back into its own width.
    const measure = () => { avail.value = document.documentElement.clientWidth - 20; };
    ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    measure();
});
onBeforeUnmount(() => { window.removeEventListener('hashchange', onHash); ro?.disconnect(); });

const size = computed(() => (view.value === 'window' ? WIN : GAME));
const fit = computed(() => Math.min(1, avail.value / size.value.w));
const boxStyle = computed(() => ({ width: size.value.w * fit.value + 'px', height: size.value.h * fit.value + 'px' }));
const stageStyle = computed(() => ({
    width: size.value.w + 'px', height: size.value.h + 'px', transform: `scale(${fit.value})`,
}));

// The overlay reads pointer coordinates as unscaled pixels; undo the demo's fit-to-screen scale.
const game = ref<HTMLElement | null>(null);
const PTR = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
function unscale(e: Event) {
    const f = fit.value;
    if (f === 1) return;
    const p = e as PointerEvent;
    const r = game.value!.getBoundingClientRect();
    Object.defineProperty(e, 'clientX', { value: r.left + (p.clientX - r.left) / f });
    Object.defineProperty(e, 'clientY', { value: r.top + (p.clientY - r.top) / f });
}
watch(game, (el, old) => {
    for (const t of PTR) old?.removeEventListener(t, unscale, true);
    for (const t of PTR) el?.addEventListener(t, unscale, true);
});

const overlayShown = computed(() => scenario.licensed && scenario.gameFound && !state.value?.hidden);
const hiddenWhy = computed(() => {
    if (!scenario.licensed) return '未授權：overlay 不會開啟';
    if (!scenario.gameFound) return '找不到遊戲視窗：overlay 不顯示';
    if (state.value?.hidden) return 'overlay 已隱藏（顯示／隱藏快捷鍵）';
    return '';
});

const TABS = [
    { id: 'battle', label: '戰鬥' }, { id: 'records', label: '紀錄' }, { id: 'characters', label: '角色' },
    { id: 'items', label: '物品' }, { id: 'equipment', label: '裝備（開發中）' }, { id: 'overlay', label: 'Overlay（測試中）' },
];
const PINNED = [
    { id: 'settings', label: '設定', icon: 'mdi-cog-outline' },
    { id: 'about', label: '關於', icon: 'mdi-information-outline' },
];
const winTab = ref('overlay');
</script>

<template>
  <div class="demo">
    <header class="bar">
      <nav class="views">
        <a v-for="v in VIEWS" :key="v.id" :href="'#' + v.id" :class="{ on: view === v.id }">{{ v.label }}</a>
      </nav>
      <div class="toggles">
        <label><input v-model="inBattle" type="checkbox">有戰鬥資料</label>
        <label><input v-model="scenario.licensed" type="checkbox">已授權</label>
        <label><input v-model="scenario.gameFound" type="checkbox">找到遊戲</label>
        <label><input v-model="scenario.elevated" type="checkbox">系統管理員</label>
      </div>
      <p class="note">
        <template v-if="view === 'edit'">解鎖狀態：可拖曳元件、拉右側把手改寬度、點角落圓鈕換錨點。按「鎖定」會切到 overlay 畫面。</template>
        <template v-else-if="view === 'overlay'">鎖定狀態：實際遊戲中滑鼠會穿透。背景為示意。</template>
        <template v-else>主視窗的 Overlay 分頁；在這裡改的設定會同步到另外兩個畫面。</template>
      </p>
    </header>
    <div class="body">
      <div class="box" :style="boxStyle">
        <div v-if="view !== 'window'" ref="game" class="stage game" :style="stageStyle">
          <div class="hud hud-bar"><i v-for="i in 10" :key="i" /></div>
          <OverlayApp v-if="overlayShown" />
          <div v-else class="why">{{ hiddenWhy }}</div>
        </div>
        <div v-else class="stage win" :style="stageStyle">
          <div class="desktop-app">
            <TitleBar variant="main" :connected="true" owner-name="阿福" license-user="demo" />
            <TabBar v-model="winTab" :tabs="TABS" :pinned="PINNED" />
            <main class="content">
              <OverlayTab v-if="winTab === 'overlay'" />
              <div v-else class="other">（demo 只做 Overlay 分頁）</div>
            </main>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
html body#demo { padding: 0; overflow: auto; background: #0b0c0e; user-select: auto; }
html body#demo, html #demo #app { height: auto; min-height: 100%; }
</style>

<style scoped>
.demo { display: flex; flex-direction: column; min-height: 100vh; overflow-x: hidden; }
.bar { position: sticky; top: 0; z-index: 10; padding: 8px 10px; background: var(--c-bg-deep); border-bottom: 1px solid var(--c-line); font-size: 14px; }
.views { display: flex; gap: 6px; flex-wrap: wrap; }
.views a { padding: 8px 12px; border-radius: 6px; color: var(--c-text-dim); text-decoration: none; background: var(--c-surface-2); }
.views a.on { color: var(--c-text); background: var(--c-accent); }
.toggles { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; color: var(--c-text-dim); font-size: 13px; }
.toggles label { display: inline-flex; align-items: center; gap: 4px; }
.note { margin: 6px 0 0; color: var(--c-text-dim); font-size: 12px; line-height: 1.5; }
.body { flex: 1; padding: 10px; }
.box { position: relative; overflow: hidden; border-radius: 6px; box-shadow: 0 0 0 1px var(--c-line); }
.stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
.game {
    background:
        radial-gradient(ellipse at 30% 70%, rgba(60, 110, 70, .55), transparent 60%),
        radial-gradient(ellipse at 75% 30%, rgba(90, 80, 140, .45), transparent 55%),
        linear-gradient(180deg, #2c3a4f 0%, #3b4a3a 55%, #26301f 100%);
}
.hud { position: absolute; background: rgba(0, 0, 0, .35); border: 1px solid rgba(255, 255, 255, .12); border-radius: 4px; }
.hud-bar { left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 4px; padding: 4px; }
.hud-bar i { width: 34px; height: 34px; background: rgba(255, 255, 255, .08); border-radius: 3px; }
.why { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, .7); font-size: 22px; }
.win { background: var(--c-bg); }
.desktop-app { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.content { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; background: var(--c-bg); }
.other { padding: 24px; color: var(--c-text-dim); }
</style>

// Demo page: the real overlay and overlay-tab components on sample data, no backend.
import { createApp } from 'vue';
import '@mdi/font/css/materialdesignicons.css';
import '../desktop/theme/tokens.css';
import '../desktop/theme/base.css';
import '../overlay/overlay.css';
import { saveSetting } from '@/lib/settingsStorage';
import { defaultOverlaySettings } from '@/lib/overlaySettings';
import ccNames from './ccNames';
import skillNames from './skillNames';

// The app uses root paths (/icons/…); the published demo serves them relative to the page.
const fix = (img: Element) => {
    const src = img.getAttribute('src');
    if (src?.startsWith('/')) img.setAttribute('src', src.slice(1));
};
new MutationObserver(muts => {
    for (const m of muts) {
        if (m.type === 'attributes') fix(m.target as Element);
        for (const n of m.addedNodes) {
            if (!(n instanceof Element)) continue;
            if (n.tagName === 'IMG') fix(n);
            n.querySelectorAll('img').forEach(fix);
        }
    }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

// The demo ships only a few skill icons; a missing one is hidden rather than shown broken.
document.addEventListener('error', e => {
    if (e.target instanceof HTMLImageElement) e.target.style.visibility = 'hidden';
}, true);

// The defaults as a first run gets them: no made-up rules.
saveSetting('overlay', defaultOverlaySettings());

void (async () => {
    const { condNameMap, skillNameMap } = await import('@/store');
    for (const [id, name] of Object.entries(ccNames)) condNameMap.value[Number(id)] = `${name} ${id}`;
    for (const [id, name] of Object.entries(skillNames)) skillNameMap.value[Number(id)] = name;
    const { default: DemoApp } = await import('./DemoApp.vue');
    createApp(DemoApp).mount('#app');
})();

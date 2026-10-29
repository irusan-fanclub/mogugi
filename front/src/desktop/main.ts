import { createApp } from 'vue';
import '@mdi/font/css/materialdesignicons.css';
import './theme/tokens.css';
import './theme/base.css';
import { installNativeMenuGuard } from './ui/nativeMenuGuard';
import { flushSettings, hydrateSettings } from '@/lib/settingsStorage';

installNativeMenuGuard();
window.addEventListener('pagehide', () => { void flushSettings(); });

// The app's modules read their settings when first imported, so load them first.
void (async () => {
    await hydrateSettings();
    const { default: DesktopApp } = await import('./DesktopApp.vue');
    createApp(DesktopApp).mount('#app');
})();

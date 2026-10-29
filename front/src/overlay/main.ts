import { createApp } from 'vue';
import '@mdi/font/css/materialdesignicons.css';
import '../desktop/theme/tokens.css';
import '../desktop/theme/base.css';
import './overlay.css';
import { installIconFallback } from '@/lib/iconFallback';
import { hydrateSettings } from '@/lib/settingsStorage';
import { installNativeMenuGuard } from '../desktop/ui/nativeMenuGuard';

installIconFallback();
installNativeMenuGuard();

// The store reads the settings (boss races) when first imported; the main window owns writing them.
void (async () => {
    await hydrateSettings({ readOnly: true });
    const { loadNameMaps } = await import('@/lib/gameData');
    void loadNameMaps();
    const { default: OverlayApp } = await import('./OverlayApp.vue');
    createApp(OverlayApp).mount('#app');
})();

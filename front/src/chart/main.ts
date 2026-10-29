import { createApp } from 'vue';
import '@mdi/font/css/materialdesignicons.css';
import '../desktop/theme/tokens.css';
import '../desktop/theme/base.css';
import ChartApp from './ChartApp.vue';
import { installNativeMenuGuard } from '../desktop/ui/nativeMenuGuard';

installNativeMenuGuard();
createApp(ChartApp).mount('#app');

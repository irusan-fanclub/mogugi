import { ref } from 'vue';
import { settingsStorage } from '@/lib/settingsStorage';

export type CcPickMode = 'icon' | 'list';

// How the CC settings show CCs; shared by the DPS 圖表 CC and 技能圖表 CC tabs.
const KEY = 'ccPickMode';
function load(): CcPickMode {
    try { return settingsStorage.getItem(KEY) === 'list' ? 'list' : 'icon'; } catch { return 'icon'; }
}
export const ccPickMode = ref<CcPickMode>(load());

export function setCcPickMode(m: CcPickMode) {
    ccPickMode.value = m;
    try { settingsStorage.setItem(KEY, m); } catch { /* storage unavailable */ }
}

export const PICK_MODE_OPTIONS = [
    { value: 'icon' as const, label: '圖示' },
    { value: 'list' as const, label: '清單' },
];

import type { Component } from 'vue';
import { isDesktop } from '@/lib/runtimeEnv';
import BattleTab from './battle/BattleTab.vue';
import RecordsTab from './records/RecordsTab.vue';
import CharactersTab from './characters/CharactersTab.vue';
import ItemsTab from './items/ItemsTab.vue';
import EquipmentTab from './equipment/EquipmentTab.vue';
import OverlayTab from './overlay/OverlayTab.vue';
import SettingsTab from './settings/SettingsTab.vue';
import AboutTab from './about/AboutTab.vue';

export interface TabDef { id: string; label: string; component: Component }

// Later tasks swap the placeholder component here; order is the bar order.
const ALL_TABS: TabDef[] = [
    { id: 'battle', label: '戰鬥', component: BattleTab },
    { id: 'records', label: '紀錄', component: RecordsTab },
    { id: 'characters', label: '角色', component: CharactersTab },
    { id: 'items', label: '物品', component: ItemsTab },
    { id: 'equipment', label: '裝備(開發中)', component: EquipmentTab },
    { id: 'overlay', label: 'Overlay(開發中)', component: OverlayTab },
];

// Overlays are desktop-only, so the browser has no overlay tab.
export const TABS: TabDef[] = ALL_TABS.filter(t => t.id !== 'overlay' || isDesktop());

export interface PinnedTabDef extends TabDef { icon: string }

// Icon-only tabs pinned at the far right of the tab bar, in order.
export const PINNED_TABS: PinnedTabDef[] = [
    { id: 'settings', label: '設定', icon: 'mdi-cog-outline', component: SettingsTab },
    { id: 'about', label: '關於', icon: 'mdi-information-outline', component: AboutTab },
];

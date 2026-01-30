import { ref, shallowRef, computed } from 'vue';
import { MabiDB } from '@/mabidb';
import { ActorManager } from '@/eventActor';
import { DamageCollectorManager } from '@/actionCollector';

export const loadingCount = ref(0);
export const isLoading = computed(() => loadingCount.value > 0);

const defaultRegion = 'tw';

export const region = ref(defaultRegion);
export const lang = ref(defaultRegion);
export const regionList = ref([defaultRegion]);

export const db = computed(() => {
    const instance = new MabiDB(region.value, lang.value);

    // // fire and forget
    // instance.open().catch(e => console.error(e));

    return instance;
});

export const raceNameMap = ref<Record<number, string>>({});
export const skillNameMap = ref<Record<number, string>>({});
export const condNameMap = ref<Record<number, string>>({});
export const itemNameMap = ref<Record<number, string>>({});
export const appEvent = ref(new EventTarget());

export const dcManager = shallowRef(new DamageCollectorManager());
export const actorManager = shallowRef(new ActorManager(dcManager.value as DamageCollectorManager));

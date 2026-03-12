import { customRef } from 'vue';
import type { Ref } from 'vue';

import { ActorManager, BaseActor, GroupActor } from '@/eventActor';

export function humanReadableNumber(n: number): string {
    if (typeof n == 'string') {
        n = parseFloat(n);
    }
    else if (typeof n != 'number') {
        return '0';
    }

    if (isNaN(n) || !isFinite(n))
        return '0';

    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1_0000_0000_0000) {
        // return sign + +((abs / 1_0000_0000_0000).toFixed(2)) + '조';
        // return sign + +((abs / 1_0000_0000_0000).toFixed(2)) + '兆';
    }
    if (abs >= 1_0000_0000) {
        // return sign + +((abs / 1_0000_0000).toFixed(2)) + '억';
        return sign + +((abs / 1_0000_0000).toFixed(2)) + '億';
    }
    if (abs >= 1_0000) {
        // return sign + +((abs / 1_0000).toFixed(2)) + '만';
        return sign + +((abs / 1_0000).toFixed(2)) + '萬';
    }
    return sign + Math.round(abs).toString();
}

export function formatDuration(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function getMabiNameColor(name: string): string {
    if (!name?.length) {
        return '#808080';
    }

    // https://mabinoger.com/color_sim.htm
    const colCalc = (i: number) => (i * 101) % 97 + 159;

    // if (name.length < 3) {
    //     return '#808080';
    // }

    const ccolor = [0, 0, 0];
    // R = (ASCII Char 1,4,7,10
    // G = (ASCII Char 2,5,8,11
    // B = (ASCII Char 3,6,9,12
    //                          * 101) mod 97) + 159
    for (let i = 0; i < name.length; i++) {
        ccolor[i % 3] += name.charCodeAt(i);
    }
    ccolor[0] = colCalc(ccolor[0]);
    ccolor[1] = colCalc(ccolor[1]);
    ccolor[2] = colCalc(ccolor[2]);

    return '#' + ccolor.map(v => v.toString(16).padStart(2, '0')).join('');
}

export interface IUpdateCallback {
    setUpdateCallback(track: () => void, trigger: () => void): void;
}

export function CustomReactive<T extends IUpdateCallback>(value: T): T {
    const state = customRef<T>((track, trigger) => {
        value.setUpdateCallback(track, trigger);

        return {
            get() {
                track();
                return value;
            },
            set(newValue: T) {
                value = newValue;
                trigger();
            },
        };
    });

    return state.value;
}

export function prettyEntityName(entity: BaseActor | undefined, raceNameMap: Ref<Record<number, string>>): string | undefined {
    if (!entity) {
        return undefined;
    }

    if (ActorManager.pcRaceSet.has(entity.raceId)) {
        return entity.name;
    }

    const raceName = raceNameMap.value[entity.raceId] || `unknownRace:${entity.raceId}`;
    if (entity instanceof GroupActor) {
        return raceName;
    }

    // for monster
    if (entity.name[0] >= '0' && entity.name[0] <= '9') {
        return `${raceName} (${entity.name.slice(-4)})`;
    }

    // for pet
    return entity.name;
}
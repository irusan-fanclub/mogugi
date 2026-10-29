import { reactive } from 'vue';

export interface ToastItem {
    id: number;
    text: string;
}

// Module-level state so any component can call show() and one <DToast> renders it.
const items = reactive<ToastItem[]>([]);
let seq = 0;

function show(text: string, ms = 2500) {
    const id = ++seq;
    items.push({ id, text });
    setTimeout(() => {
        const i = items.findIndex(t => t.id === id);
        if (i >= 0) items.splice(i, 1);
    }, ms);
}

export function useToast() {
    return { items, show };
}

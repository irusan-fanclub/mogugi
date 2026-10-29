import { inject, type InjectionKey } from 'vue';
import type { BackendSession } from '@/lib/backendSession';

// Provided by DesktopApp; tabs only mount after activation, so it is set.
export const SESSION_KEY: InjectionKey<() => BackendSession | null> = Symbol('backendSession');
// Returns true (and shows the license screen) when e is a 403 from /api.
export const LICENSE_GUARD_KEY: InjectionKey<(e: unknown) => boolean> = Symbol('licenseGuard');

export function useSession(): BackendSession {
    const s = inject(SESSION_KEY, null)?.() ?? null;
    if (!s) throw new Error('backend session is not available before activation');
    return s;
}

export function useLicenseGuard(): (e: unknown) => boolean {
    const g = inject(LICENSE_GUARD_KEY, null);
    if (!g) throw new Error('license guard is not provided; mount inside DesktopApp');
    return g;
}

// Provided by DesktopApp: switches the active tab by registry id.
export const TAB_SWITCH_KEY: InjectionKey<(id: string) => void> = Symbol('tabSwitch');

export function useTabSwitch(): (id: string) => void {
    return inject(TAB_SWITCH_KEY, () => {});
}

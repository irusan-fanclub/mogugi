import { LicenseRequiredError } from '@/lib/configApi';
import { useLicenseGuard } from './session';

// fetch for /api calls: a 403 sends the shell back to the license screen and
// rejects with LicenseRequiredError. Call from a component setup.
export function useApiFetch(): (input: string, init?: RequestInit) => Promise<Response> {
    const guard = useLicenseGuard();
    return async (input, init) => {
        const r = await fetch(input, init);
        if (r.status === 403) {
            const e = new LicenseRequiredError();
            guard(e);
            throw e;
        }
        return r;
    };
}

import { describe, it, expect } from 'vitest';
import { OVERLAY_EVENT_IDS, overlayWants } from './overlayEvents';

describe('overlayEvents', () => {
    // Pinned against TestOverlayWantsIds in internal/app/overlayClient_test.go.
    it('lists the same ids as the Go overlayWants', () => {
        expect([...OVERLAY_EVENT_IDS].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 14, 17, 20, 26, 27]);
    });

    it('passes system events and drops unrelated ones', () => {
        expect(overlayWants({ EventId: -6 })).toBe(true);
        expect(overlayWants({ EventId: 10 })).toBe(false);
        expect(overlayWants({ EventId: 3 })).toBe(true);
    });
});

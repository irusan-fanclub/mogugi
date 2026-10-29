// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CcOverlay from './CcOverlay.vue';
import { defaultOverlaySettings } from '@/lib/overlaySettings';
import { activeIcons } from '@/lib/overlayModel';
import type { EntityCondition } from '@/eventActor';

describe('CcOverlay', () => {
    it('titles the owner section 自身, not 自己', () => {
        const w = mount(CcOverlay, {
            props: {
                vm: { boss: null, self: { id: 'me', name: 'Me', icons: [] }, party: [] },
                settings: defaultOverlaySettings().cc,
            },
        });
        expect(w.find('[data-section="self"]').text()).toBe('自身');
    });

    it('has no skill cooldown section', () => {
        const w = mount(CcOverlay, {
            props: {
                vm: { boss: null, self: { id: 'me', name: 'Me', icons: [] }, party: [] },
                settings: defaultOverlaySettings().cc,
            },
        });
        expect(w.find('[data-section="cooldown"]').exists()).toBe(false);
    });

    it('an icon the alert rules mark red gets the expiring class', () => {
        const cond = (DisableAt: number) => ({ DisableAt }) as unknown as EntityCondition;
        const icons = activeIcons({ 4: cond(1000), 5: cond(1000) }, [4, 5], 100, id => id === 4);
        const w = mount(CcOverlay, {
            props: {
                vm: { boss: { id: 'b', name: 'B', icons }, self: null, party: [] },
                settings: defaultOverlaySettings().cc,
            },
        });
        expect(w.findAll('[data-icon]').map(i => i.classes().includes('expiring'))).toEqual([true, false]);
    });
});

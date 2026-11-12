// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defaultCcSection } from '@/lib/overlaySections';
import FrameLookFields from './FrameLookFields.vue';

const mk = (look = defaultCcSection('ccBoss').look) => mount(FrameLookFields, {
    props: { look, section: 'ccBoss', follow: null },
});

describe('FrameLookFields', () => {
    it('文字大小 follows 圖示大小 and patches text/tpx', async () => {
        const w = mk();
        const labels = w.findAll('.ovs-lbl').map(l => l.text());
        expect(labels.indexOf('文字大小')).toBe(labels.indexOf('圖示大小') + 1);
        const row = w.findAll('.ovs-field').find(f => f.text().includes('文字大小'))!;
        expect((row.get('[data-size-px]').element as HTMLInputElement).value).toBe('12');
        await row.findAll('[role="radio"]').find(r => r.text() === '特大')!.trigger('click');
        expect(w.emitted('update:look')![0][0]).toMatchObject({ text: 'xl' });
        await row.findAll('[role="radio"]').find(r => r.text() === '自訂')!.trigger('click');
        expect(w.emitted('update:look')![1][0]).toMatchObject({ text: 'c', tpx: 12 });
    });
    it('hidden while following the main frame', () => {
        const w = mount(FrameLookFields, { props: { look: defaultCcSection('ccBoss').look, section: 'ccBoss', follow: true } });
        expect(w.text()).not.toContain('文字大小');
    });
});

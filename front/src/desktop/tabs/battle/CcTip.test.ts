// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CcTip from './CcTip.vue';
import { condNameMap } from '@/store';

beforeEach(() => {
    condNameMap.value[1164] = '減少防禦/保護';
});

const rowsOf = (w: ReturnType<typeof mount>) => w.findAll('.kv > span').map(s => s.text());

describe('CcTip', () => {
    it('shows name, value rows, and coverage for 1164', () => {
        const w = mount(CcTip, {
            props: {
                ccId: 1164, hint: '右鍵選單，拖曳排序',
                summary: { values: { MCDDDV: '103', MCDDPV: '28', MCDDDPV: '22', SBT: '9', MCDCASI: '24201' }, coveragePct: 94.44 },
            },
        });
        expect(w.find('.head').text()).toContain('減少防禦/保護');
        expect(rowsOf(w)).toEqual([
            '防禦', '−103', 'MCDDDV', '保護', '−28', 'MCDDPV', 'MCDDDPV', '22', '', '覆蓋率', '94.4%', '',
        ]);
        expect(w.find('.src').exists()).toBe(false);
        expect(w.find('.hint').text()).toBe('右鍵選單，拖曳排序');
        expect(w.find('.kv .key').classes()).toContain('key');
    });

    it('shows an unknown CC raw ', () => {
        const w = mount(CcTip, { props: { ccId: 4242, summary: { values: { FOO: '3' }, coveragePct: 100 } } });
        expect(rowsOf(w)).toEqual(['FOO', '3', '', '覆蓋率', '100%', '']);
    });

    it('says the CC never triggered without a summary', () => {
        const w = mount(CcTip, { props: { ccId: 1164, summary: undefined } });
        expect(w.find('.none').text()).toBe('這場沒有觸發');
        expect(w.find('.kv').exists()).toBe(false);
    });
});

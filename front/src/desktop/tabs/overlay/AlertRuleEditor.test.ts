// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import type { AlertRule } from '@/lib/overlaySettings';
import { condNameMap } from '@/store';
import AlertRuleEditor from './AlertRuleEditor.vue';

const rule: AlertRule = {
    id: 'a', enabled: true, kind: 'countdown', target: 'self', ccId: 680, times: [25, 15, 5], every: 30,
    conds: [], join: 'and', text: true, textMessage: '', voice: true, voiceMessage: '', textKeep: 5, loud: false,
    dismiss: { condFails: false, ccEnds: false, replaced: false },
};
const periodic: AlertRule = { ...rule, kind: 'periodic', ccId: 0, times: [] };

let w: VueWrapper | null = null;
beforeEach(() => { condNameMap.value = { 680: '序曲', 516: '覺醒', 1234: '圖安之魂' }; });
afterEach(() => { w?.unmount(); w = null; });
const last = () => w!.emitted('update:rule')!.at(-1)![0] as AlertRule;
const radio = (label: string) => w!.findAll('[role="radio"]').find(r => r.text() === label)!;
const check = (label: string) => w!.findAll('[role="checkbox"]').find(r => r.text() === label);
const field = (sel: string) => {
    const el = w!.get(sel);
    return el.element.tagName === 'INPUT' ? el : el.get('input');
};

describe('AlertRuleEditor', () => {
    it('shows the default sentence as the text placeholder', () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        expect(field('[data-rule-message]').attributes('placeholder')).toBe('{名字} {CC} 剩 {秒} 秒');
    });

    it('a periodic rule shows its own default sentence and hint', () => {
        w = mount(AlertRuleEditor, { props: { rule: periodic } });
        expect(field('[data-rule-message]').attributes('placeholder')).toBe('{名字} 條件成立');
        expect(w.text()).not.toContain('{CC}、{秒}');
    });

    it('countdown shows the cc and time points, periodic shows the interval', () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        expect(w.find('[data-rule-times]').exists()).toBe(true);
        expect(w.find('[data-rule-every]').exists()).toBe(false);
        expect(w.text()).toContain('都不勾：只把圖示轉紅');
        w.unmount();
        w = mount(AlertRuleEditor, { props: { rule: periodic } });
        expect(w.find('[data-rule-times]').exists()).toBe(false);
        expect(w.find('[data-rule-every]').exists()).toBe(true);
        expect(w.text()).not.toContain('都不勾：只把圖示轉紅');
    });

    it('switching the kind emits the matching shape', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        await radio('定時檢查').trigger('click');
        expect(last()).toMatchObject({ kind: 'periodic', ccId: 0, times: [] });
        w.unmount();
        w = mount(AlertRuleEditor, { props: { rule: periodic } });
        await radio('倒數提醒').trigger('click');
        expect(last()).toMatchObject({ kind: 'countdown', ccId: 680, times: [10] });
    });

    it('editing the interval emits an integer', async () => {
        w = mount(AlertRuleEditor, { props: { rule: periodic } });
        const inp = field('[data-rule-every]');
        await inp.setValue('45');
        await inp.trigger('blur');
        expect(last().every).toBe(45);
    });

    it('adds a condition seeded with the rule cc, then edits and removes it', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        await w.get('[data-cond-add]').trigger('click');
        expect(last().conds).toEqual([{ mode: 'absent', ccId: 680 }]);
        w.unmount();
        const withCond = { ...rule, conds: [{ mode: 'absent' as const, ccId: 680 }] };
        w = mount(AlertRuleEditor, { props: { rule: withCond } });
        await radio('有').trigger('click');
        expect(last().conds).toEqual([{ mode: 'present', ccId: 680 }]);
        await w.get('[data-cond-remove]').trigger('click');
        expect(last().conds).toEqual([]);
    });

    it('a periodic rule seeds a new condition with a default cc', async () => {
        w = mount(AlertRuleEditor, { props: { rule: periodic } });
        await w.get('[data-cond-add]').trigger('click');
        expect(last().conds).toEqual([{ mode: 'absent', ccId: 680 }]);
    });

    it('picking a cc for a condition row', async () => {
        const withCond = { ...rule, conds: [{ mode: 'absent' as const, ccId: 680 }, { mode: 'absent' as const, ccId: 516 }] };
        w = mount(AlertRuleEditor, { props: { rule: withCond } });
        await w.findAll('[data-cond-row] [data-cc-picker-toggle]')[1].trigger('click');
        await w.findAll('[data-pick]').find(r => r.text().includes('圖安之魂'))!.trigger('click');
        expect(last().conds).toEqual([{ mode: 'absent', ccId: 680 }, { mode: 'absent', ccId: 1234 }]);
    });

    it('the join selector appears only with two or more conditions', async () => {
        const one = { ...rule, conds: [{ mode: 'absent' as const, ccId: 680 }] };
        w = mount(AlertRuleEditor, { props: { rule: one } });
        expect(w.find('[data-join]').exists()).toBe(false);
        w.unmount();
        w = mount(AlertRuleEditor, { props: { rule: { ...one, conds: [...one.conds, { mode: 'present' as const, ccId: 516 }] } } });
        expect(w.find('[data-join]').exists()).toBe(true);
        await radio('任一成立（或）').trigger('click');
        expect(last().join).toBe('or');
    });

    it('voice content shows only when voice is on, and is empty-able', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        expect(field('[data-rule-voice-message]').attributes('placeholder')).toBe('留空念文字內容');
        await field('[data-rule-voice-message]').setValue('快');
        expect(last().voiceMessage).toBe('快');
        w.unmount();
        w = mount(AlertRuleEditor, { props: { rule: { ...rule, voice: false, text: false } } });
        expect(w.find('[data-rule-voice-message]').exists()).toBe(false);
        expect(w.find('[data-rule-message]').exists()).toBe(false);
    });

    it('text content edits textMessage', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        await field('[data-rule-message]').setValue('hi');
        expect(last().textMessage).toBe('hi');
    });

    it('edits how long the text stays', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        const inp = field('[data-rule-keep]');
        await inp.setValue('12');
        await inp.trigger('blur');
        expect(last().textKeep).toBe(12);
    });

    it('dismiss reasons toggle; the cc-ends reason is countdown only', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        await check('條件不再成立時')!.trigger('click');
        expect(last().dismiss).toEqual({ condFails: true, ccEnds: false, replaced: false });
        await check('監測的 CC 結束時')!.trigger('click');
        expect(last().dismiss.ccEnds).toBe(true);
        await check('同規則下一則出現時取代')!.trigger('click');
        expect(last().dismiss.replaced).toBe(true);
        w.unmount();
        w = mount(AlertRuleEditor, { props: { rule: periodic } });
        expect(check('監測的 CC 結束時')).toBeUndefined();
        expect(check('條件不再成立時')).toBeDefined();
    });

    it('picking a cc from the search list', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        await w.get('[data-cc-picker-toggle]').trigger('click');
        await w.findAll('[data-pick]').find(r => r.text().includes('覺醒'))!.trigger('click');
        expect(last().ccId).toBe(516);
    });

    it('試聽 emits preview', async () => {
        w = mount(AlertRuleEditor, { props: { rule } });
        await w.get('[data-rule-preview]').trigger('click');
        expect(w.emitted('preview')).toHaveLength(1);
    });
});

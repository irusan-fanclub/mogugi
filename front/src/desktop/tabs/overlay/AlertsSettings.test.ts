// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import { defaultOverlaySettings, type AlertRule, type OverlaySettings } from '@/lib/overlaySettings';
import { condNameMap } from '@/store';

const settings = ref<OverlaySettings>(defaultOverlaySettings());
vi.mock('../../overlay/overlayLink', () => ({
    get overlaySettings() { return settings; },
    updateOverlaySettings: (mut: (s: OverlaySettings) => void) => {
        const next = JSON.parse(JSON.stringify(settings.value)) as OverlaySettings;
        mut(next);
        settings.value = next;
    },
}));

import AlertsSettings from './AlertsSettings.vue';
import { ruleSummary, parseTimes } from './ruleSummary';

const prelude: AlertRule = {
    id: 'a', enabled: true, kind: 'countdown', target: 'self', ccId: 680, times: [25, 15, 5], every: 30,
    conds: [{ mode: 'absent', ccId: 1234 }], join: 'and', text: true, textMessage: '', voice: true, voiceMessage: '', textKeep: 5, loud: false,
    dismiss: { condFails: false, ccEnds: false, replaced: false },
};

let w: VueWrapper | null = null;
let spoken: SpeechSynthesisUtterance[] = [];
beforeEach(() => {
    settings.value = defaultOverlaySettings();
    condNameMap.value = { 680: '戰場的序曲', 1234: '圖安之魂', 516: '覺醒' };
    spoken = [];
    vi.stubGlobal('speechSynthesis', {
        getVoices: () => [
            { name: 'Alpha', lang: 'en-US' },
            { name: 'Mei', lang: 'zh-TW' },
        ],
        speak: (u: SpeechSynthesisUtterance) => { spoken.push(u); },
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
    });
});
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); });

const mountIt = () => (w = mount(AlertsSettings, { attachTo: document.body }));
const input = (sel: string) => w!.get(`${sel} input, input${sel}`);

describe('ruleSummary', () => {
    const nameOf = (id: number) => condNameMap.value[id] ?? `CC ${id}`;
    it('matches the spec example', () => {
        expect(ruleSummary(prelude, nameOf)).toBe('自身 戰場的序曲 剩 25／15／5 秒，沒有 圖安之魂 時：文字＋語音');
    });
    it('covers target labels, present condition and delivery', () => {
        expect(ruleSummary({ ...prelude, target: 'boss', conds: [], voice: false }, nameOf)).toBe('BOSS 戰場的序曲 剩 25／15／5 秒：文字');
        expect(ruleSummary({ ...prelude, target: 'party', conds: [{ mode: 'present', ccId: 516 }], text: false }, nameOf))
            .toBe('其他隊友 戰場的序曲 剩 25／15／5 秒，有 覺醒 時：語音');
        expect(ruleSummary({ ...prelude, target: 'all', conds: [{ mode: 'present', ccId: 516 }], text: false }, nameOf))
            .toBe('全隊 戰場的序曲 剩 25／15／5 秒，有 覺醒 時：語音');
        expect(ruleSummary({ ...prelude, conds: [], text: false, voice: false }, nameOf)).toBe('自身 戰場的序曲 剩 25／15／5 秒：只轉紅');
    });
    it('joins several conditions with 且 or 或', () => {
        const conds = [{ mode: 'absent' as const, ccId: 1234 }, { mode: 'present' as const, ccId: 516 }];
        expect(ruleSummary({ ...prelude, target: 'all', conds, voice: false }, nameOf))
            .toBe('全隊 戰場的序曲 剩 25／15／5 秒，沒有 圖安之魂 且 有 覺醒 時：文字');
        expect(ruleSummary({ ...prelude, conds, join: 'or', text: false }, nameOf))
            .toBe('自身 戰場的序曲 剩 25／15／5 秒，沒有 圖安之魂 或 有 覺醒 時：語音');
    });
    it('describes an appear rule and a loud text', () => {
        const appear = { ...prelude, kind: 'appear' as const, ccId: 516, times: [], conds: [], loud: true };
        expect(ruleSummary(appear, nameOf)).toBe('自身 覺醒 出現時：文字＋語音（醒目）');
        expect(ruleSummary({ ...appear, text: false, voice: false }, nameOf)).toBe('自身 覺醒 出現時：不提醒');
    });
    it('describes a periodic rule', () => {
        const periodic = { ...prelude, kind: 'periodic' as const, ccId: 0, times: [], every: 30, voice: false };
        expect(ruleSummary({ ...periodic, conds: [{ mode: 'absent', ccId: 1234 }, { mode: 'absent', ccId: 516 }], join: 'or' }, nameOf))
            .toBe('自身 每 30 秒，沒有 圖安之魂 或 沒有 覺醒 時：文字');
        expect(ruleSummary({ ...periodic, conds: [], every: 5 }, nameOf)).toBe('自身 每 5 秒：文字');
        expect(ruleSummary({ ...periodic, conds: [], text: false }, nameOf)).toBe('自身 每 30 秒：不提醒');
    });
    it('parseTimes dedups and sorts descending', () => {
        expect(parseTimes('5, 25,15, 15')).toEqual([25, 15, 5]);
        expect(parseTimes('abc, 0, -3')).toEqual([]);
    });
});

describe('AlertsSettings', () => {
    it('shows the summary line for each rule', () => {
        settings.value.rules = [prelude];
        mountIt();
        expect(w!.get('[data-rule-summary]').text()).toBe('自身 戰場的序曲 剩 25／15／5 秒，沒有 圖安之魂 時：文字＋語音');
    });

    it('adds rules with unique non-empty ids and opens the editor', async () => {
        mountIt();
        await w!.get('[data-add-rule]').trigger('click');
        await w!.get('[data-add-rule]').trigger('click');
        const ids = settings.value.rules.map(r => r.id).slice(-2);
        expect(settings.value.rules).toHaveLength(8);
        expect(ids.every(i => i !== '')).toBe(true);
        expect(new Set(ids).size).toBe(2);
        expect(w!.findAll('[data-rule-editor]')).toHaveLength(1);
    });

    it('stores typed time points deduped and descending', async () => {
        settings.value.rules = [prelude];
        mountIt();
        await w!.get('[data-rule-edit]').trigger('click');
        await input('[data-rule-times]').setValue('5, 25,15, 15');
        expect(settings.value.rules[0].times).toEqual([25, 15, 5]);
    });

    it('edits target, condition and delivery', async () => {
        settings.value.rules = [prelude];
        mountIt();
        await w!.get('[data-rule-edit]').trigger('click');
        const ed = w!.get('[data-rule-editor]');
        await ed.findAll('[role="radio"]').find(r => r.text() === 'BOSS')!.trigger('click');
        expect(settings.value.rules[0].target).toBe('boss');
        await w!.get('[data-cond-remove]').trigger('click');
        expect(settings.value.rules[0].conds).toEqual([]);
        await ed.findAll('[role="checkbox"]').find(r => r.text() === '語音')!.trigger('click');
        expect(settings.value.rules[0].voice).toBe(false);
    });

    it('switching to a periodic rule shows the interval and hides the cc and time points', async () => {
        settings.value.rules = [prelude];
        mountIt();
        await w!.get('[data-rule-edit]').trigger('click');
        expect(w!.find('[data-rule-times]').exists()).toBe(true);
        expect(w!.find('[data-rule-every]').exists()).toBe(false);
        const ed = w!.get('[data-rule-editor]');
        await ed.findAll('[role="radio"]').find(r => r.text() === '定時檢查')!.trigger('click');
        expect(settings.value.rules[0]).toMatchObject({ kind: 'periodic', ccId: 0, times: [] });
        expect(w!.find('[data-rule-times]').exists()).toBe(false);
        expect(w!.find('[data-rule-every]').exists()).toBe(true);
        expect(w!.get('[data-rule-summary]').text()).toBe('自身 每 30 秒，沒有 圖安之魂 時：文字＋語音');
    });

    it('switching back to countdown restores a cc and time points', async () => {
        settings.value.rules = [{ ...prelude, kind: 'periodic', ccId: 0, times: [] }];
        mountIt();
        await w!.get('[data-rule-edit]').trigger('click');
        await w!.get('[data-rule-editor]').findAll('[role="radio"]').find(r => r.text() === '倒數提醒')!.trigger('click');
        expect(settings.value.rules[0]).toMatchObject({ kind: 'countdown', ccId: 680, times: [10] });
    });

    it('toggles and removes a rule', async () => {
        settings.value.rules = [prelude];
        mountIt();
        await w!.get('[data-rule] [role="switch"]').trigger('click');
        expect(settings.value.rules[0].enabled).toBe(false);
        await w!.get('[data-rule-remove] button, button[data-rule-remove]').trigger('click');
        expect(settings.value.rules).toEqual([]);
    });

    it('stores mute, rate and volume', async () => {
        mountIt();
        await w!.get('[data-voice-muted]').trigger('click');
        expect(settings.value.voice.muted).toBe(true);
        await w!.get('[data-voice-rate]').setValue('1.5');
        expect(settings.value.voice.rate).toBe(1.5);
        await w!.get('[data-voice-volume]').setValue('40');
        expect(settings.value.voice.volume).toBe(40);
    });

    it('restore puts back deleted default rules and then hides itself', async () => {
        mountIt();
        expect(w!.find('[data-restore-rules]').exists()).toBe(false);
        settings.value = { ...settings.value, rules: settings.value.rules.filter(r => r.id !== 'd-def') };
        await nextTick();
        await w!.get('[data-restore-rules]').trigger('click');
        expect(settings.value.rules.map(r => r.id)).toContain('d-def');
        await nextTick();
        expect(w!.find('[data-restore-rules]').exists()).toBe(false);
    });

    it('adds countdown rules with the new defaults', async () => {
        mountIt();
        await w!.get('[data-add-rule]').trigger('click');
        expect(settings.value.rules.at(-1)).toMatchObject({
            kind: 'countdown', conds: [], join: 'and', textMessage: '', voiceMessage: '', textKeep: 5, loud: false, every: 30,
            dismiss: { condFails: false, ccEnds: false, replaced: false },
        });
    });

    it('a rule 試聽 speaks the voice sentence, falling back to the text sentence', async () => {
        settings.value.rules = [{ ...prelude, textMessage: '文{秒}', voiceMessage: '' }];
        mountIt();
        await w!.get('[data-rule-edit]').trigger('click');
        await w!.get('[data-rule-preview]').trigger('click');
        expect(spoken.map(u => u.text)).toEqual(['文15']);
        spoken = [];
        settings.value.rules = [{ ...prelude, textMessage: '文{秒}', voiceMessage: '聲{名字}' }];
        await w!.vm.$nextTick();
        await w!.get('[data-rule-preview]').trigger('click');
        expect(spoken.map(u => u.text)).toEqual(['聲測試']);
    });

    it('試聽 speaks the default sentence filled with test values', async () => {
        mountIt();
        await w!.get('[data-voice-preview]').trigger('click');
        expect(spoken.map(u => u.text)).toEqual(['測試 戰場的序曲 剩 15 秒']);
    });
});

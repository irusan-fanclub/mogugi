// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { resetSettingsForTest, settingsStorage } from '@/lib/settingsStorage';
import { mount, VueWrapper } from '@vue/test-utils';
import CcResetPrompt from './CcResetPrompt.vue';
import { resetCCTracking, setChartHiddenCCIds, setSelfTrackedCCIds, setTrackedCCIds, selfTrackedCCIds, trackedCCIds } from './ccSettings';
import { resetSkillCcModel, setSkillCcList, skillCcModel } from './skillCcSettings';
import { ccDefaultsFingerprint, ccDiffersFromDefaults } from './ccDefaults';
import { DEFAULT_CC_LIST, DEFAULT_SELF_CC_LIST } from '@/lib/ccTracking';
import { defaultSkillCcModel } from '@/lib/skillCcLists';

let w: VueWrapper | null = null;
beforeEach(() => { resetCCTracking(); resetSkillCcModel(); resetSettingsForTest(); });
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = ''; });
const mountIt = () => (w = mount(CcResetPrompt, { attachTo: document.body }));
const dialog = () => document.querySelector('[role="dialog"]');
const OLD = 'deadbeef';

describe('ccDefaults', () => {
    it('the defaults match themselves; any of the three lists changing differs', () => {
        expect(ccDiffersFromDefaults()).toBe(false);
        setChartHiddenCCIds(new Set([...DEFAULT_CC_LIST].reverse().slice(0, 1)));
        expect(ccDiffersFromDefaults()).toBe(true);
        resetCCTracking();
        setSelfTrackedCCIds([1]);
        expect(ccDiffersFromDefaults()).toBe(true);
        resetCCTracking();
        setSkillCcList(3, 'self', []);
        expect(ccDiffersFromDefaults()).toBe(true);
    });
    it('the fingerprint is a stable 8-digit hex id', () => {
        expect(ccDefaultsFingerprint()).toMatch(/^[0-9a-f]{8}$/);
        expect(ccDefaultsFingerprint()).toBe(ccDefaultsFingerprint());
    });
});

describe('CcResetPrompt', () => {
    it('first run never asks and records the defaults', () => {
        setTrackedCCIds([494, 1]);
        mountIt();
        expect(dialog()).toBeNull();
        expect(settingsStorage.getItem('lastSeenCcDefaults')).toBe(ccDefaultsFingerprint());
    });

    it('unchanged defaults never ask, even with custom lists', () => {
        settingsStorage.setItem('lastSeenCcDefaults', ccDefaultsFingerprint());
        setTrackedCCIds([494, 1]);
        mountIt();
        expect(dialog()).toBeNull();
    });

    it('changed defaults but lists already equal them: no prompt', () => {
        settingsStorage.setItem('lastSeenCcDefaults', OLD);
        mountIt();
        expect(dialog()).toBeNull();
        expect(settingsStorage.getItem('lastSeenCcDefaults')).toBe(ccDefaultsFingerprint());
    });

    it('changed defaults and lists differ: asks; 換成新預設 resets all three lists', async () => {
        settingsStorage.setItem('lastSeenCcDefaults', OLD);
        setTrackedCCIds([494, 1]);
        setSelfTrackedCCIds([2]);
        setSkillCcList('common', 'boss', [3]);
        mountIt();
        await nextTick();
        expect(dialog()!.textContent).toContain('CC 預設已更新');
        document.querySelector<HTMLElement>('[data-reset]')!.click();
        await nextTick();
        expect(trackedCCIds.value).toEqual(DEFAULT_CC_LIST);
        expect(selfTrackedCCIds.value).toEqual(DEFAULT_SELF_CC_LIST);
        expect(skillCcModel.value).toEqual(defaultSkillCcModel());
        expect(dialog()).toBeNull();
    });

    it('保留目前的 keeps the lists and does not ask again', async () => {
        settingsStorage.setItem('lastSeenCcDefaults', OLD);
        setTrackedCCIds([494, 1]);
        mountIt();
        await nextTick();
        document.querySelector<HTMLElement>('[data-keep]')!.click();
        await nextTick();
        expect(trackedCCIds.value).toEqual([494, 1]);
        expect(settingsStorage.getItem('lastSeenCcDefaults')).toBe(ccDefaultsFingerprint());
    });
});

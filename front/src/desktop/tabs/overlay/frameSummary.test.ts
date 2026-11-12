import { describe, it, expect } from 'vitest';
import { defaultCcSection, defaultCooldownSection } from '@/lib/overlaySections';
import { frameSummary } from './frameSummary';

describe('frameSummary', () => {
    it('cc party: size, names, arrange, dim', () => {
        const look = { ...defaultCcSection('ccParty').look, names: 'member' as const, arrange: 'flow' as const };
        expect(frameSummary(look, 'ccParty', null)).toBe('中・隊友名・平鋪・40%');
        expect(frameSummary({ ...look, arrange: 'byMember', gap: 'pack' }, 'ccParty', null))
            .toBe('中・隊友名・依隊友排列（往左補齊）・40%');
        expect(frameSummary({ ...look, arrange: 'byMember' }, 'ccParty', null)).toContain('留空對齊');
    });
    it('cc boss has no arrange; custom size shows px', () => {
        const look = { ...defaultCcSection('ccBoss').look, size: 'c' as const, px: 50, names: 'none' as const };
        expect(frameSummary(look, 'ccBoss', null)).toBe('自訂 50px・無・40%');
    });
    it('cooldown: names, arrange, no dim', () => {
        const look = defaultCooldownSection().look;
        expect(frameSummary(look, 'cooldown', null)).toBe('中・名字・平鋪');
        expect(frameSummary({ ...look, names: false }, 'cooldown', null)).toBe('中・無名字・平鋪');
    });
    it('burst: size only', () => {
        expect(frameSummary({ ...defaultCcSection('burst').look, size: 'l' }, 'burst', null)).toBe('大');
    });
    it('xl icon shows 特大; text size only when not 中', () => {
        const look = { ...defaultCcSection('ccBoss').look, size: 'xl' as const };
        expect(frameSummary(look, 'ccBoss', null)).toBe('特大・文字・40%');
        expect(frameSummary({ ...look, size: 'm', text: 'xl' }, 'ccBoss', null)).toBe('中・文字・40%・字特大');
        expect(frameSummary({ ...look, size: 'm', text: 's' }, 'ccBoss', null)).toBe('中・文字・40%・字小');
        expect(frameSummary({ ...look, size: 'm', text: 'c', tpx: 15 }, 'ccBoss', null)).toBe('中・文字・40%・字 15px');
        expect(frameSummary({ ...defaultCooldownSection().look, text: 'l' }, 'cooldown', null)).toBe('中・名字・平鋪・字大');
    });
    it('follow wins', () => {
        expect(frameSummary(defaultCcSection('ccParty').look, 'ccParty', '隊伍 CC')).toBe('跟『隊伍 CC』一樣');
    });
});

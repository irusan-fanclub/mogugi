import { describe, it, expect } from 'vitest';
import { CHAR_SLOTS, colorCode, slotName, sortByCharSlot } from './charSlots';

describe('charSlots', () => {
    it('names the approved slots', () => {
        const names = [3, 4, 8, 5, 6, 7, 9, 16, 17, 10, 12, 11, 13, 46, 43, 44, 45, 47, 48, 90, 91, 92].map(slotName);
        expect(names).toEqual([
            '臉型', '髮型', '裝備-頭部', '裝備-身體', '裝備-手部', '裝備-腳部', '裝備-長袍', '裝備-左飾品', '裝備-右飾品',
            '主手', '副手', '背後主手', '背後副手',
            '時裝-頭部', '時裝-身體', '時裝-手部', '時裝-腳部', '時裝-長袍', '時裝-臉部裝飾', '時裝-尾巴', '時裝-左飾品', '時裝-右飾品',
        ]);
        expect([51, 54, 32, 35, 62, 64].map(slotName)).toEqual(['威光', '星塵', '遺物1', '遺物4', '回音石1', '回音石3']);
        expect(new Set(CHAR_SLOTS.map(s => s.pocket)).size).toBe(CHAR_SLOTS.length);
    });
    it('falls back to the pocket number for unknown pockets', () => {
        expect(slotName(12)).toBe('副手');
        expect(slotName(13)).toBe('背後副手');
        expect(slotName(14)).toBe('欄位 14');
    });
    it('sorts in display order with unknown pockets last, by number', () => {
        const order = [92, 99, 3, 13, 10, 12, 46, 8, 4, 5, 54].map(p => ({ PocketType: p }));
        expect(sortByCharSlot(order).map(i => i.PocketType)).toEqual([3, 4, 8, 5, 10, 12, 13, 46, 92, 54, 99]);
    });
    it('colorCode strips alpha, lowercases and pads', () => {
        expect(colorCode('#fffcf3e4')).toBe('#fcf3e4');
        expect(colorCode('#DFEFE0')).toBe('#dfefe0');
        expect(colorCode('#10000095')).toBe('#000095');
        expect(colorCode('#000000')).toBe('#000000');
        expect(colorCode('#95')).toBe('#000095');
    });
});

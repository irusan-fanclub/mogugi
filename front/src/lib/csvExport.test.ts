// csvExport.test.ts — buildCsv 純函式的單元測試（vitest）。
import { describe, it, expect } from 'vitest';
import { buildCsv } from './csvExport';

describe('buildCsv', () => {
    it('joins header and rows with CRLF', () => {
        const csv = buildCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
        expect(csv).toBe('a,b\r\n1,2\r\n3,4');
    });

    it('quotes a field containing a comma', () => {
        const csv = buildCsv(['name'], [['foo,bar']]);
        expect(csv).toBe('name\r\n"foo,bar"');
    });

    it('quotes a field containing a double quote and doubles it', () => {
        const csv = buildCsv(['name'], [['say "hi"']]);
        expect(csv).toBe('name\r\n"say ""hi"""');
    });

    it('quotes a field containing a newline', () => {
        const csv = buildCsv(['note'], [['line1\nline2']]);
        expect(csv).toBe('note\r\n"line1\nline2"');
    });

    it('leaves plain fields unquoted', () => {
        const csv = buildCsv(['a', 'b'], [['物品', '5']]);
        expect(csv).toBe('a,b\r\n物品,5');
    });

    it('includes the header row even with no data rows', () => {
        const csv = buildCsv(['a', 'b'], []);
        expect(csv).toBe('a,b');
    });
});

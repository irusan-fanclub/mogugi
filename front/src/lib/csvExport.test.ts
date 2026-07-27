// csvExport.test.ts — buildCsv / sortRows 純函式的單元測試（vitest）。
import { describe, it, expect } from 'vitest';
import { buildCsv, sortRows } from './csvExport';

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

    it('quotes a field containing a bare carriage return', () => {
        const csv = buildCsv(['note'], [['a\rb']]);
        expect(csv).toBe('note\r\n"a\rb"');
    });
});

describe('sortRows', () => {
    it('returns rows unchanged when sortBy is empty', () => {
        const rows = [{ qty: 2 }, { qty: 1 }];
        expect(sortRows(rows, [])).toBe(rows);
    });

    it('sorts numeric fields numerically, not lexically', () => {
        const rows = [{ qty: 9 }, { qty: 10 }, { qty: 2 }];
        expect(sortRows(rows, [{ key: 'qty', order: 'asc' }]).map(r => r.qty))
            .toEqual([2, 9, 10]);
    });

    it('reverses order for desc', () => {
        const rows = [{ qty: 9 }, { qty: 10 }, { qty: 2 }];
        expect(sortRows(rows, [{ key: 'qty', order: 'desc' }]).map(r => r.qty))
            .toEqual([10, 9, 2]);
    });

    it('sorts string fields case-insensitively', () => {
        const rows = [{ name: 'banana' }, { name: 'Apple' }, { name: 'cherry' }];
        expect(sortRows(rows, [{ key: 'name', order: 'asc' }]).map(r => r.name))
            .toEqual(['Apple', 'banana', 'cherry']);
    });

    it('sorts empty strings before non-empty ones', () => {
        const rows = [{ name: 'x' }, { name: '' }, { name: 'a' }];
        expect(sortRows(rows, [{ key: 'name', order: 'asc' }]).map(r => r.name))
            .toEqual(['', 'a', 'x']);
    });

    it('breaks ties using the second sort key', () => {
        const rows = [
            { group: 'b', qty: 2 },
            { group: 'a', qty: 2 },
            { group: 'a', qty: 1 },
        ];
        const sorted = sortRows(rows, [
            { key: 'group', order: 'asc' },
            { key: 'qty', order: 'asc' },
        ]);
        expect(sorted).toEqual([
            { group: 'a', qty: 1 },
            { group: 'a', qty: 2 },
            { group: 'b', qty: 2 },
        ]);
    });

    it('does not mutate the input array', () => {
        const rows = [{ qty: 2 }, { qty: 1 }];
        sortRows(rows, [{ key: 'qty', order: 'asc' }]);
        expect(rows.map(r => r.qty)).toEqual([2, 1]);
    });
});

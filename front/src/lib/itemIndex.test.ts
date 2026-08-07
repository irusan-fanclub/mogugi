// itemIndex.test.ts — search box query classification (vitest, pure logic).
import { describe, it, expect } from 'vitest';
import { parseSearchQuery, parseExcludeEntries, buildExcludeSets, isExcludeEmpty } from './itemIndex';

describe('parseSearchQuery', () => {
    it('treats blank input as empty', () => {
        expect(parseSearchQuery('').kind).toBe('empty');
        expect(parseSearchQuery('   ').kind).toBe('empty');
    });

    it('treats a bare number as an item id', () => {
        const q = parseSearchQuery('12345');
        expect(q).toEqual({ kind: 'id', id: 12345 });
    });

    it('lowercases a plain text needle', () => {
        const q = parseSearchQuery('  ShaDow  ');
        expect(q).toEqual({ kind: 'text', needle: 'shadow' });
    });

    it('reads /pattern/ as a regex defaulting to case-insensitive', () => {
        const q = parseSearchQuery('/蘑菇/');
        if (q.kind !== 'regex') throw new Error(`expected regex, got ${q.kind}`);
        expect(q.re.source).toBe('蘑菇');
        expect(q.re.flags).toBe('i');
    });

    it('keeps only the allowed flags', () => {
        const q = parseSearchQuery('/abc/gimy');
        if (q.kind !== 'regex') throw new Error(`expected regex, got ${q.kind}`);
        // g would make .test() stateful across calls, so it is dropped.
        expect(q.re.flags).toBe('im');
    });

    it('forces `i` on even when the user asks for other flags without it', () => {
        // The haystack is lowercased, so a case-sensitive match would silently
        // match nothing — `i` must survive regardless of what was typed.
        const q = parseSearchQuery('/abc/m');
        if (q.kind !== 'regex') throw new Error(`expected regex, got ${q.kind}`);
        expect(q.re.flags).toContain('i');
    });

    it('takes the last slash so a pattern may contain slashes', () => {
        const q = parseSearchQuery('/a\\/b/');
        if (q.kind !== 'regex') throw new Error(`expected regex, got ${q.kind}`);
        expect(q.re.source).toBe('a\\/b');
    });

    it('prefers regex over the numeric id shortcut', () => {
        expect(parseSearchQuery('/123/').kind).toBe('regex');
    });

    it('reports an invalid pattern instead of throwing', () => {
        const q = parseSearchQuery('/[/');
        if (q.kind !== 'error') throw new Error(`expected error, got ${q.kind}`);
        expect(q.message.length).toBeGreaterThan(0);
    });

    it('does not treat // as a regex', () => {
        expect(parseSearchQuery('//')).toEqual({ kind: 'text', needle: '//' });
    });
});

describe('parseExcludeEntries', () => {
    it('returns an empty list for null', () => {
        expect(parseExcludeEntries(null)).toEqual([]);
    });

    it('returns an empty list for broken JSON', () => {
        expect(parseExcludeEntries('{not json')).toEqual([]);
    });

    it('returns an empty list when the payload is not an array', () => {
        expect(parseExcludeEntries('{"col":"item","value":"x"}')).toEqual([]);
    });

    it('keeps well-formed entries', () => {
        const raw = JSON.stringify([
            { col: 'item', value: '生命藥水' },
            { col: 'storage', value: '銀行' },
        ]);
        expect(parseExcludeEntries(raw)).toEqual([
            { col: 'item', value: '生命藥水' },
            { col: 'storage', value: '銀行' },
        ]);
    });

    it('drops entries with an unknown column or a non-string value', () => {
        const raw = JSON.stringify([
            { col: 'bag', value: '背包' },
            { col: 'item', value: 42 },
            { col: 'item' },
            null,
            { col: 'entity', value: '小白' },
        ]);
        expect(parseExcludeEntries(raw)).toEqual([{ col: 'entity', value: '小白' }]);
    });

    it('drops entries with an empty value', () => {
        const raw = JSON.stringify([{ col: 'item', value: '' }]);
        expect(parseExcludeEntries(raw)).toEqual([]);
    });

    it('de-duplicates identical entries', () => {
        const raw = JSON.stringify([
            { col: 'item', value: '生命藥水' },
            { col: 'item', value: '生命藥水' },
        ]);
        expect(parseExcludeEntries(raw)).toHaveLength(1);
    });

    // The same string may legitimately appear in two different columns.
    it('keeps the same value under two different columns', () => {
        const raw = JSON.stringify([
            { col: 'entity', value: '銀行' },
            { col: 'storage', value: '銀行' },
        ]);
        expect(parseExcludeEntries(raw)).toHaveLength(2);
    });
});

describe('buildExcludeSets / isExcludeEmpty', () => {
    it('groups entries by column', () => {
        const sets = buildExcludeSets([
            { col: 'item', value: '生命藥水' },
            { col: 'item', value: '魔力藥水' },
            { col: 'storage', value: '銀行' },
        ]);
        expect([...sets.item].sort()).toEqual(['生命藥水', '魔力藥水']);
        expect([...sets.storage]).toEqual(['銀行']);
        expect(sets.entity.size).toBe(0);
    });

    it('reports an all-empty set as empty', () => {
        expect(isExcludeEmpty(buildExcludeSets([]))).toBe(true);
    });

    it('reports a set with any entry as not empty', () => {
        expect(isExcludeEmpty(buildExcludeSets([{ col: 'entity', value: '小白' }]))).toBe(false);
    });
});

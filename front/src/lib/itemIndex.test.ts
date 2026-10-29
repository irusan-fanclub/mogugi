// itemIndex.test.ts — search box query classification (vitest, pure logic).
import { describe, it, expect } from 'vitest';
import { parseSearchQuery, buildExcludeSets, isExcludeEmpty } from './itemIndex';

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

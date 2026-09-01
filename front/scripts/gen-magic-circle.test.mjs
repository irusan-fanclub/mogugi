// gen-magic-circle.test.mjs — pure-function tests for the ability resolver.
// No file I/O: exercises resolveAbilities() directly with synthetic input.
import { describe, it, expect } from 'vitest';
import { resolveAbilities } from './gen-magic-circle.mjs';

describe('resolveAbilities', () => {
    it('keeps the LAST xml occurrence when an id repeats (dup-id last-wins)', () => {
        const entries = [
            { id: 1, descIdx: 10 },
            { id: 1, descIdx: 11 },
        ];
        const localeMap = new Map([['10', 'first text'], ['11', 'second text']]);
        expect(resolveAbilities(entries, localeMap).get(1)).toBe('second text');
    });

    it('skips an id whose resolved locale index has no text', () => {
        const entries = [{ id: 2, descIdx: 99 }];
        expect(resolveAbilities(entries, new Map()).has(2)).toBe(false);
    });

    it('keeps unrelated ids independent', () => {
        const entries = [{ id: 1, descIdx: 10 }, { id: 2, descIdx: 20 }];
        const localeMap = new Map([['10', 'a'], ['20', 'b']]);
        const out = resolveAbilities(entries, localeMap);
        expect(out.get(1)).toBe('a');
        expect(out.get(2)).toBe('b');
    });
});

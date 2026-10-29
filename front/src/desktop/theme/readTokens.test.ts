// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { readTokens } from './readTokens';

afterEach(() => document.documentElement.removeAttribute('style'));

describe('readTokens', () => {
    it('reads CSS variables from the root element', () => {
        document.documentElement.style.setProperty('--c-accent', ' #e8a33d ');
        expect(readTokens(['--c-accent'])).toEqual({ '--c-accent': '#e8a33d' });
    });
});

import { describe, expect, test } from 'vitest';
import { isDesktop, wsUrl } from './runtimeEnv';

describe('runtimeEnv', () => {
  test('isDesktop', () => {
    expect(isDesktop(new URL('http://wails.localhost/index.html'))).toBe(true);
    expect(isDesktop(new URL('http://127.0.0.1:8030/'))).toBe(false);
  });
  test('wsUrl', () => {
    expect(wsUrl(new URL('http://wails.localhost/index.html?wsPort=8032'))).toBe('ws://127.0.0.1:8032/ws');
    expect(wsUrl(new URL('http://127.0.0.1:8030/'))).toBe('ws://127.0.0.1:8030/ws');
    expect(wsUrl(new URL('http://192.168.1.5:8030/'))).toBe('ws://192.168.1.5:8030/ws');
    expect(wsUrl(new URL('https://example.com/'))).toBe('wss://example.com/ws');
  });
  test('wsUrl on desktop without a valid wsPort throws a clear error', () => {
    expect(() => wsUrl(new URL('http://wails.localhost/index.html'))).toThrow(/wsPort/);
    expect(() => wsUrl(new URL('http://wails.localhost/index.html?wsPort=abc'))).toThrow(/wsPort/);
  });
});

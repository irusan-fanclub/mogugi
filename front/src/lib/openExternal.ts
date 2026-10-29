import { isDesktop } from './runtimeEnv';

// The Wails WebView cannot open external pages itself; hand the URL to the OS browser.
export function openExternal(url: string): void {
    if (isDesktop()) void import('@wailsio/runtime').then(rt => rt.Browser.OpenURL(url));
    else window.open(url, '_blank', 'noopener');
}

import { isDesktop } from './runtimeEnv';

// The Wails runtime is imported lazily so the browser build never loads it.
async function runtime() {
  return isDesktop() ? import('@wailsio/runtime') : null;
}

export async function onDesktopEvent(name: string, cb: (data: unknown) => void): Promise<(() => void) | undefined> {
  const rt = await runtime();
  return rt?.Events.On(name, (e: { data: unknown }) => cb(e.data));
}

export async function desktopWindow() {
  return (await runtime())?.Window;
}

export async function emitDesktop(name: string, data?: unknown): Promise<void> {
  const rt = await runtime();
  await rt?.Events.Emit(name, data);
}

// Loads the Wails runtime (it announces readiness to the Go side on load).
// With ?selftest=1 (set only by MOGUGI_SELFTEST) it is exposed for the probe.
export async function initDesktop(): Promise<void> {
  const rt = await runtime();
  if (rt && new URLSearchParams(location.search).has('selftest')) {
    (window as unknown as { wails: unknown }).wails = rt;
  }
}

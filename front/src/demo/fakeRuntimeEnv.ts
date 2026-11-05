// Demo stand-in for runtimeEnv: pretend to be the desktop shell; there is no backend.
export function isDesktop(): boolean {
    return true;
}

export function wsUrl(): string {
    return 'ws://127.0.0.1:0/ws';
}

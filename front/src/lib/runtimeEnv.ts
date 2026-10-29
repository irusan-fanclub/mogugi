// Desktop (Wails WebView2) pages are served from wails.localhost, so the
// backend WebSocket must target the loopback TCP port passed in ?wsPort.
export function isDesktop(loc: Pick<Location, 'hostname'> = location): boolean {
  return loc.hostname === 'wails.localhost';
}

export function wsUrl(loc: Pick<Location, 'hostname' | 'host' | 'protocol' | 'search'> = location): string {
  if (isDesktop(loc)) {
    const port = new URLSearchParams(loc.search).get('wsPort');
    if (!port || !/^\d+$/.test(port)) throw new Error('桌面模式缺少 wsPort 參數，無法連線到後端。');
    return `ws://127.0.0.1:${port}/ws`;
  }
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`;
}

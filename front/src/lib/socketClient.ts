import * as protocols from '@/protocols';

export class SocketClient {
    private socket?: WebSocket;
    private reconnectDelay = 1000;
    private static readonly MAX_RECONNECT_DELAY = 30000;

    public onConnect?: (isConnected: boolean) => void;
    public onEvent?: (events: protocols.eventBase[]) => void;

    constructor(private url: string) { }

    public connect() {
        if (this.socket?.readyState === WebSocket.OPEN) {
            return;
        }

        const s = this.socket = new WebSocket(this.url);

        setTimeout(() => {
            if (s.readyState == WebSocket.CONNECTING) {
                console.log('connection timeout...');
                s.close();
                this.socket = undefined;
            }
        }, 5000);

        s.onopen = () => {
            console.log("socket open");
            this.reconnectDelay = 1000;
            this.onConnect?.(true);
        };

        s.onmessage = e => {
            const events = JSON.parse(e.data) as protocols.eventBase[];
            this.onEvent?.(events);
        };

        s.onerror = e => {
            console.log('socket error', e);
            s.close();
        };

        s.onclose = e => {
            console.log('socket close', e);
            this.onConnect?.(false);
            this.socket = undefined;

            const delay = this.reconnectDelay;
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                SocketClient.MAX_RECONNECT_DELAY,
            );
            setTimeout(() => this.connect(), delay);
        };
    }
}

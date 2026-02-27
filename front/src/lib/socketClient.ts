import * as protocols from '@/protocols';

export class SocketClient {
    private socket?: WebSocket;

    // true -> connected, false -> disconnected or connecting
    public onConnect?: (isConnected: boolean) => void;
    public onEvent?: (entity: protocols.eventBase) => void;

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
            this.onConnect?.(true);
        };

        s.onmessage = e => {
            const event = JSON.parse(e.data) as protocols.eventBase;
            // console.log(event);
            this.onEvent?.(event);
        };

        s.onerror = e => {
            console.log('socket error', e);
            s.close();

            // setTimeout(openSocket, 0);
        };

        s.onclose = e => {
            console.log('socket close', e);
            this.onConnect?.(false);
            s.close();

            this.socket = undefined;

            setTimeout(() => this.connect(), 0);
        };
    }
}
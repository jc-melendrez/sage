import TcpSocket from 'react-native-tcp-socket';
import { LAN_PORT, LanMessage, LanResultPayload, LineBuffer, encodeMessage } from './lanProtocol';

export class LanClientSession {
  private socket: any = null;
  private buffer: LineBuffer;
  private disposed = false;
  onEvent: (msg: LanMessage) => void;

  constructor(onEvent: (msg: LanMessage) => void) {
    this.buffer = new LineBuffer(msg => {
      if (!this.disposed) this.onEvent(msg);
    });
    this.onEvent = onEvent;
  }

  connect(hostIp: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = TcpSocket.createConnection({ host: hostIp.trim(), port: LAN_PORT }, () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        this.socket = socket;
        resolve();
      });
      const timer = setTimeout(() => {
        try {
          socket.destroy();
        } catch {}
        reject(new Error('Timed out connecting to host'));
      }, 8000);
      socket.on('data', (d: any) => this.buffer.push(d));
      socket.on('error', (e: any) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.on('close', () => {
        this.socket = null;
        if (!this.disposed) this.onEvent({ t: 'end', reason: 'Connection lost' });
      });
    });
  }

  get connected(): boolean {
    return !!this.socket;
  }

  send(msg: LanMessage) {
    if (!this.socket) return;
    try {
      for (const line of encodeMessage(msg)) this.socket.write(line);
    } catch {}
  }

  join(code: string, name: string, avatar?: string) {
    this.send({ t: 'hello', code, name, avatar });
  }

  submitResult(data: LanResultPayload) {
    this.send({ t: 'result', data });
  }

  disconnect() {
    this.disposed = true;
    try {
      this.socket?.destroy();
    } catch {}
    this.socket = null;
  }
}
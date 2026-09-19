import UdpSockets from 'react-native-udp';

export const BEACON_PORT = 5051;
const BEACON_INTERVAL = 2000;
const PING_INTERVAL = 1500;
const ROOM_TTL = 6000;

export interface DiscoveredRoom {
  code: string;
  quizTitle: string;
  players: number;
  started: boolean;
  hostIp: string;
  lastSeen: number;
}

interface AdvertiseInfo {
  code: string;
  quizTitle: string;
  getPlayers: () => number;
  started: boolean;
}

let advertiser: { socket: any; timer: any; info: AdvertiseInfo } | null = null;
let scanner: { socket: any; timer: any; rooms: Map<string, DiscoveredRoom>; onChange: (rooms: DiscoveredRoom[]) => void } | null = null;

function beaconPayload(info: AdvertiseInfo): string {
  return JSON.stringify({
    t: 'sage-beacon',
    v: 1,
    code: info.code,
    title: info.quizTitle,
    players: info.getPlayers(),
    started: info.started,
  });
}

export function isAdvertising(): boolean {
  return !!advertiser;
}

export function startAdvertising(code: string, quizTitle: string, getPlayers: () => number, started: boolean = false): boolean {
  if (advertiser) stopAdvertising();
  if (!code) return false;
  let socket: any;
  try {
    socket = UdpSockets.createSocket({ type: 'udp4' });
  } catch {
    return false;
  }
  const info: AdvertiseInfo = { code, quizTitle, getPlayers, started };
  advertiser = { socket, info, timer: null };

  socket.on('listening', () => {
    try {
      socket.setBroadcast(true);
    } catch {}
  });

  const broadcast = () => {
    const line = beaconPayload(info) + '\n';
    try {
      socket.send(line, 0, line.length, BEACON_PORT, '255.255.255.255');
    } catch {}
  };

  const reply = (payload: string, port: number, address: string) => {
    const line = payload + '\n';
    try {
      socket.send(line, 0, line.length, port, address);
    } catch {}
  };

  socket.on('message', (data: any, rinfo: any) => {
    if (rinfo && rinfo.port === BEACON_PORT && info.started) return;
    let text = '';
    try {
      text = typeof data === 'string' ? data : data.toString('utf8');
    } catch {}
    if (text.includes('sage-ping')) {
      reply(beaconPayload(info), rinfo.port || BEACON_PORT, rinfo.address);
    }
  });
  socket.on('error', () => {});

  try {
    socket.bind(BEACON_PORT);
  } catch {
    advertiser = null;
    try {
      socket.close();
    } catch {}
    return false;
  }

  advertiser.timer = setInterval(broadcast, BEACON_INTERVAL);
  const t = setTimeout(broadcast, 100);
  return true;
}

export function stopAdvertising() {
  if (!advertiser) return;
  const { socket, timer } = advertiser;
  if (timer) clearInterval(timer);
  try {
    socket.close();
  } catch {}
  advertiser = null;
}

export function startScanning(onChange: (rooms: DiscoveredRoom[]) => void): boolean {
  if (scanner) stopScanning();
  let socket: any;
  try {
    socket = UdpSockets.createSocket({ type: 'udp4' });
  } catch {
    return false;
  }
  const rooms = new Map<string, DiscoveredRoom>();
  scanner = { socket, rooms, onChange, timer: null };

  const prune = () => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastSeen > ROOM_TTL) rooms.delete(code);
    }
    try {
      onChange([...rooms.values()].sort((a, b) => a.code.localeCompare(b.code)));
    } catch {}
  };

  const ping = () => {
    const line = JSON.stringify({ t: 'sage-ping', v: 1 }) + '\n';
    try {
      socket.send(line, 0, line.length, BEACON_PORT, '255.255.255.255');
    } catch {}
  };

  socket.on('listening', () => {
    try {
      socket.setBroadcast(true);
    } catch {}
    ping();
  });

  socket.on('message', (data: any, rinfo: any) => {
    let text = '';
    try {
      text = typeof data === 'string' ? data : data.toString('utf8');
    } catch {}
    if (!text.includes('sage-beacon')) return;
    let msg: any = null;
    try {
      msg = JSON.parse(text.split('\n')[0]);
    } catch {}
    if (!msg || !msg.code) return;
    const hostIp = (rinfo && rinfo.address) || '';
    if (!hostIp) return;
    rooms.set(msg.code, {
      code: msg.code,
      quizTitle: msg.title || '',
      players: Number(msg.players) || 0,
      started: !!msg.started,
      hostIp,
      lastSeen: Date.now(),
    });
    prune();
  });
  socket.on('error', () => {});

  try {
    socket.bind(BEACON_PORT);
  } catch {
    scanner = null;
    try {
      socket.close();
    } catch {}
    return false;
  }

  scanner.timer = setInterval(() => {
    prune();
    ping();
  }, PING_INTERVAL);
  return true;
}

export function stopScanning() {
  if (!scanner) return;
  const { socket, timer } = scanner;
  if (timer) clearInterval(timer);
  try {
    socket.close();
  } catch {}
  scanner = null;
}

export function isScanning(): boolean {
  return !!scanner;
}
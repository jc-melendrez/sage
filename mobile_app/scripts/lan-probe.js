#!/usr/bin/env node
// Dev probe: fakes a phone joining a LAN host over TCP (port 5050),
// and can also test UDP room discovery (port 5051).
//
// TCP:  node scripts/lan-probe.js <IP> [name]       (join a host running on a phone)
// UDP:  node scripts/lan-probe.js host <code> [title]   (PC advertises a room, phone scans)
//       node scripts/lan-probe.js scan                (PC listens for rooms, phone advertises)
const dgram = require('dgram');
const net = require('net');

const BEACON_PORT = 5051;
const mode = process.argv[2];

if (mode === 'host') {
  const code = process.argv[3] || '1234';
  const title = process.argv[4] || 'PC Spike Quiz';
  const socket = dgram.createSocket('udp4');
  const beacon = () => {
    const line = JSON.stringify({ t: 'sage-beacon', v: 1, code, title, players: 0, started: false }) + '\n';
    socket.setBroadcast(true);
    socket.send(line, 0, line.length, BEACON_PORT, '255.255.255.255', err => {
      if (err) console.error('[udp-host] broadcast error:', err.message);
    });
  };
  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (text.includes('sage-ping')) {
      const line = JSON.stringify({ t: 'sage-beacon', v: 1, code, title, players: 0, started: false }) + '\n';
      socket.send(line, 0, line.length, rinfo.port, rinfo.address);
      console.log('[udp-host] ping from', rinfo.address, `-> replied with room ${code}`);
    }
  });
  socket.on('error', e => console.error('[udp-host] error:', e.message));
  socket.bind(BEACON_PORT, () => {
    setInterval(beacon, 2000);
    setTimeout(beacon, 100);
    console.log(`[udp-host] advertising room ${code} ("${title}") on port ${BEACON_PORT} (Ctrl+C to stop)`);
  });
  process.on('SIGINT', () => { socket.close(); process.exit(0); });
  return;
}

if (mode === 'scan') {
  const socket = dgram.createSocket('udp4');
  const rooms = new Map();
  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (!text.includes('sage-beacon')) return;
    let m;
    try { m = JSON.parse(text.split('\n')[0]); } catch { return; }
    if (!m.code) return;
    rooms.set(m.code, { code: m.code, title: m.title, players: m.players, hostIp: rinfo.address, at: Date.now() });
    console.log('[udp-scan]', [...rooms.values()].map(r => `${r.hostIp} room ${r.code} "${r.title}" (${r.players}p)`).join('\n[udp-scan] '));
  });
  socket.on('error', e => console.error('[udp-scan] error:', e.message));
  socket.bind(BEACON_PORT, () => {
    console.log(`[udp-scan] listening on port ${BEACON_PORT} for room beacons…`);
    const ping = () => {
      const line = JSON.stringify({ t: 'sage-ping', v: 1 }) + '\n';
      socket.setBroadcast(true);
      socket.send(line, 0, line.length, BEACON_PORT, '255.255.255.255');
    };
    setInterval(ping, 1500);
    setTimeout(ping, 100);
  });
  process.on('SIGINT', () => { socket.close(); process.exit(0); });
  return;
}

const ip = mode || process.argv[2] || '127.0.0.1';
const name = process.argv[3] || 'PROBE';
const port = 5050;

const socket = net.createConnection({ host: ip, port }, () => {
  console.log('[probe] connected, joining…');
  const hello = JSON.stringify({ t: 'hello', code: '', name }) + '\n';
  const welcome = JSON.stringify({ t: 'hello', code: '', name: 'PROBE_COPY' }) + '\n';
  socket.write(hello);
  socket.write(welcome);
});

let buf = '';
socket.on('data', d => {
  buf += d.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.log('[probe] partial raw:', line.slice(0, 80)); continue; }
    if (msg.t === 'welcome') {
      console.log('[probe] welcome in room', msg.roomCode);
    } else if (msg.t === 'roster') {
      console.log('[probe] roster:', msg.players.map(p => `${p.name}:${p.score}`).join(', '));
    } else if (msg.t === 'quiz') {
      console.log('[probe] got quiz', JSON.stringify(msg.quiz).length, 'bytes, order', msg.order.length);
    } else if (msg.t === 'start') {
      console.log('[probe] START received');
      setTimeout(() => {
        const result = { t: 'result', data: { score: 1200, correctCount: 4, answeredCount: 7, totalQuestions: 10 } };
        socket.write(JSON.stringify(result) + '\n');
        console.log('[probe] submitted fake result 1200/4-of-7');
      }, 500);
    } else if (msg.t === 'leaderboard') {
      console.log('[probe] leaderboard:', msg.players.map(p => `${p.name}:${p.score}`).join(', '));
    } else if (msg.t === 'end') {
      console.log('[probe] game ended:', msg.reason);
      socket.end();
      process.exit(0);
    } else {
      console.log('[probe] msg:', msg.t);
    }
  }
});

socket.on('error', e => {
  console.error('[probe] error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('[probe] 60s timeout — finishing');
  socket.end();
  process.exit(0);
}, 60000);
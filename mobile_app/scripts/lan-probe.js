#!/usr/bin/env node
// Dev probe: fakes a phone joining a LAN host over TCP (port 5050).
// Run the host screen on a device, then:  node scripts/lan-probe.js <IP> [name]
const net = require('net');

const ip = process.argv[2] || '127.0.0.1';
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
/* ==========================================================================
   ArenaX — extends test-pool-e2e.js past matchmaking+start into the actual
   shot-exchange flow, exactly mirroring what PoolOnline.reportShotResult()
   does: POST /rooms/action with {type:'shot_result', nextTurn, keepTurn,...}
   and check whether the OTHER client receives it via Realtime, and whether
   any call gets rejected (403 "Not your turn" or otherwise).

   Usage: node scripts/test-pool-shot.js
   ========================================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@supabase', 'supabase-js'));

const API = 'http://localhost:5000/api';
const SUPA_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  return data.token || data.data?.token;
}

async function apiPost(token, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return res.json();
}

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

async function main() {
  console.log('=== Logging in both test users ===');
  const t1 = await login('chesstester1@test.local', 'Test1234!');
  const t2 = await login('chesstester2@test.local', 'Test1234!');
  const u1 = decodeJwt(t1).id;
  const u2 = decodeJwt(t2).id;
  console.log('P1 (host) userId:', u1);
  console.log('P2 (guest) userId:', u2);

  console.log('\n=== Clearing stale queue/room state ===');
  await apiPost(t1, '/matchmaking/leave', {});
  await apiPost(t2, '/matchmaking/leave', {});

  console.log('\n=== Matchmaking: P1 joins, P2 joins (should match) ===');
  const join1 = await apiPost(t1, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  console.log('join1:', JSON.stringify(join1));
  const join2 = await apiPost(t2, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  console.log('join2:', JSON.stringify(join2));
  const roomCode = join2.roomCode;
  const roomId = join2.room.id;
  console.log('roomCode:', roomCode, '| roomId:', roomId);

  const clientP1 = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });
  const clientP2 = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });

  const p1Events = [];
  const p2Events = [];

  const chanP1 = clientP1.channel(`room:${roomCode}`, { config: { broadcast: { self: true } } });
  chanP1.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (change) => { console.log('[P1 sees]', change.new.type, JSON.stringify(change.new.payload).slice(0, 200)); p1Events.push(change.new); });

  const chanP2 = clientP2.channel(`room:${roomCode}`, { config: { broadcast: { self: true } } });
  chanP2.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (change) => { console.log('[P2 sees]', change.new.type, JSON.stringify(change.new.payload).slice(0, 200)); p2Events.push(change.new); });

  await new Promise((resolve) => {
    let n = 0;
    const check = () => { n++; if (n === 2) resolve(); };
    chanP1.subscribe((status) => { if (status === 'SUBSCRIBED') check(); });
    chanP2.subscribe((status) => { if (status === 'SUBSCRIBED') check(); });
  });
  console.log('Both channels SUBSCRIBED.');

  console.log('\n=== Ready: P1 first, then P2 (should trigger start) ===');
  const ready1 = await apiPost(t1, '/rooms/ready', { roomCode });
  console.log('ready1:', JSON.stringify(ready1).slice(0, 150));
  const ready2 = await apiPost(t2, '/rooms/ready', { roomCode });
  console.log('ready2 started:', ready2.started, '| firstTurn:', ready2.firstTurn);

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n=== SHOT 1: P1 (host) reports shot_result, turn should pass to P2 ===');
  const shot1 = await apiPost(t1, '/rooms/action', {
    roomCode,
    action: { type: 'shot_result', nextTurn: 2, keepTurn: false, ballInHand: false, assignedType: null, finalBalls: [] }
  });
  console.log('shot1 response:', JSON.stringify(shot1));

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n=== SHOT 2: P2 (guest) reports shot_result, turn should pass back to P1 ===');
  const shot2 = await apiPost(t2, '/rooms/action', {
    roomCode,
    action: { type: 'shot_result', nextTurn: 1, keepTurn: false, ballInHand: false, assignedType: null, finalBalls: [] }
  });
  console.log('shot2 response:', JSON.stringify(shot2));

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n=== SHOT 3: P1 reports again — proves the loop keeps working, not just once ===');
  const shot3 = await apiPost(t1, '/rooms/action', {
    roomCode,
    action: { type: 'shot_result', nextTurn: 2, keepTurn: false, ballInHand: false, assignedType: null, finalBalls: [] }
  });
  console.log('shot3 response:', JSON.stringify(shot3));

  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n=== RESULTS ===');
  console.log('shot1 success:', shot1.success, '| shot2 success:', shot2.success, '| shot3 success:', shot3.success);
  console.log('P1 received action events:', p1Events.filter(e => e.type === 'action').length, '(expect 2: shot2, shot3 — echoes of its own actions are suppressed client-side, but Realtime still delivers the row to everyone subscribed)');
  console.log('P2 received action events:', p2Events.filter(e => e.type === 'action').length, '(expect 2: shot1, shot3)');

  const anyFailed = !shot1.success || !shot2.success || !shot3.success;
  process.exit(anyFailed ? 2 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

/* ==========================================================================
   ArenaX — measures the latency gap between the TWO DIFFERENT transports
   pool online uses, to prove the ordering race that corrupts turn state.

   During a shot, PoolOnline sends:
     - 'sync' ball positions  -> RAW BROADCAST      (channel.send, ~fast)
     - 'shot_result' outcome  -> REST /rooms/action -> DB INSERT -> postgres_changes (slow)

   There is NO ordering guarantee between these two transports. If the final
   in-flight 'sync' (carrying still-MOVING ball velocities) lands AFTER the
   'shot_result' (which zeroes all velocities and hands the turn over), the
   watching client ends up with moving balls on its own turn. It then runs
   physics, sees the table "settle", and resolves a shot it never took.

   This script fires a broadcast and a REST action at the same instant and
   reports which arrives first, and by how much.

   Usage: node scripts/test-transport-race.js
   ========================================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@supabase', 'supabase-js'));

const API = 'http://localhost:5000/api';
const SUPA_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const d = await res.json();
  return d.token || d.data?.token;
}
async function apiPost(token, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function main() {
  const t1 = await login('chesstester1@test.local', 'Test1234!');
  const t2 = await login('chesstester2@test.local', 'Test1234!');
  await apiPost(t1, '/matchmaking/leave', {});
  await apiPost(t2, '/matchmaking/leave', {});
  await apiPost(t1, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  const j2 = await apiPost(t2, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  const roomCode = j2.roomCode, roomId = j2.room.id;

  // Watcher = P2, mirroring the non-shooting client's subscriptions exactly.
  const watcher = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });
  const shooter = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });

  let syncAt = null, resultAt = null;

  const wChan = watcher.channel(`room:${roomCode}`, { config: { broadcast: { self: true } } });
  wChan.on('broadcast', { event: 'game:action' }, ({ payload }) => {
    if (payload?.action?.type === 'sync' && syncAt === null) {
      syncAt = Date.now();
      console.log('[watcher] got SYNC (raw broadcast) at +' + (syncAt - t0) + 'ms');
    }
  });
  wChan.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (change) => {
      if (change.new.payload?.action?.type === 'shot_result' && resultAt === null) {
        resultAt = Date.now();
        console.log('[watcher] got SHOT_RESULT (REST->DB->realtime) at +' + (resultAt - t0) + 'ms');
      }
    });

  const sChan = shooter.channel(`room:${roomCode}`, { config: { broadcast: { self: true } } });

  await new Promise((resolve) => {
    let n = 0; const done = () => { if (++n === 2) resolve(); };
    wChan.subscribe((s) => { if (s === 'SUBSCRIBED') done(); });
    sChan.subscribe((s) => { if (s === 'SUBSCRIBED') done(); });
  });

  await apiPost(t1, '/rooms/ready', { roomCode });
  await apiPost(t2, '/rooms/ready', { roomCode });
  await new Promise(r => setTimeout(r, 1200));

  console.log('\n=== Firing BOTH transports at the same instant (as a real shot does) ===');
  var t0 = Date.now();
  // Raw broadcast sync, exactly like startStreamingShot's interval payload
  sChan.send({ type: 'broadcast', event: 'game:action',
    payload: { action: { type: 'sync', balls: [{ number: 0, x: 100, y: 100, vx: 9, vy: 4, isPocketed: false }] }, by: 'shooter' } });
  // REST shot_result, exactly like reportShotResult
  apiPost(t1, '/rooms/action', { roomCode,
    action: { type: 'shot_result', nextTurn: 2, keepTurn: false, ballInHand: false, assignedType: null, finalBalls: [] } });

  await new Promise(r => setTimeout(r, 4000));

  console.log('\n=== RESULTS ===');
  console.log('sync   arrived at: ' + (syncAt ? '+' + (syncAt - t0) + 'ms' : 'NEVER'));
  console.log('result arrived at: ' + (resultAt ? '+' + (resultAt - t0) + 'ms' : 'NEVER'));
  if (syncAt && resultAt) {
    const gap = resultAt - syncAt;
    console.log('\nGap (result - sync) = ' + gap + 'ms');
    console.log('The REST/DB path is ' + Math.abs(gap) + 'ms ' + (gap > 0 ? 'SLOWER' : 'FASTER') + ' than raw broadcast.');
    console.log('\n>>> Any sync emitted within ' + Math.abs(gap) + 'ms before the shot_result');
    console.log('>>> will land AFTER it on the watcher — re-introducing MOVING balls');
    console.log('>>> on the watcher\'s own turn. streamStreamingShot broadcasts every 50ms,');
    console.log('>>> so with a ' + Math.abs(gap) + 'ms gap that is ~' + Math.ceil(Math.abs(gap) / 50) + ' sync packet(s) landing late.');
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });

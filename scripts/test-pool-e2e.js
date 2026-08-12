/* ==========================================================================
   ArenaX — full pool online E2E simulation using the REAL REST API +
   REAL Supabase Realtime, driven exactly like two browser tabs would:

   1. Both users log in (real JWT).
   2. Both join the matchmaking queue for '8ball-pool' (real /api call).
   3. BOTH clients subscribe to postgres_changes on room_events BEFORE
      either calls /rooms/ready — mirroring socketClient.joinGame(), which
      the browser calls right after being matched, before Ready is ever
      clicked.
   4. Player 1 (host) calls /rooms/ready first -> server returns started:false.
      Does host's own client see anything? (It shouldn't yet.)
   5. Player 2 (guest) calls /rooms/ready second -> server returns
      started:true directly to player 2's HTTP call.
   6. THE KEY QUESTION: does Player 1 (who called Ready first and got
      started:false) receive the 'start' row via their postgres_changes
      subscription, the way their real browser tab would rely on to ever
      call PoolOnline.handlePoolStart()?

   Usage: node scripts/test-pool-e2e.js
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
  console.log('P1 userId:', u1);
  console.log('P2 userId:', u2);

  console.log('\n=== Clearing any stale queue entries ===');
  await apiPost(t1, '/matchmaking/leave', {});
  await apiPost(t2, '/matchmaking/leave', {});

  console.log('\n=== P1 joins matchmaking queue ===');
  const join1 = await apiPost(t1, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  console.log(join1);

  console.log('\n=== P2 joins matchmaking queue (should MATCH) ===');
  const join2 = await apiPost(t2, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  console.log(join2);
  const roomCode = join2.roomCode;
  const roomId = join2.room.id;
  console.log('roomCode:', roomCode, '| roomId:', roomId);

  // ---- Mirror socketClient.joinGame(): BOTH players subscribe to
  // postgres_changes on room_events BEFORE calling Ready, exactly like
  // startQuickMatch() calls ensureConnected() + joinGame() as soon as
  // response.matched is true, well before the user clicks the Ready button.
  console.log('\n=== Both clients subscribing to Realtime BEFORE Ready ===');
  const clientP1 = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });
  const clientP2 = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });

  let p1SawStart = null;
  let p2SawStart = null;

  const chanP1 = clientP1.channel(`room:${roomCode}`, { config: { broadcast: { self: true } } });
  chanP1.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (change) => {
      console.log('[P1 channel] received row type:', change.new.type);
      if (change.new.type === 'start') p1SawStart = change.new.payload;
    });

  const chanP2 = clientP2.channel(`room:${roomCode}`, { config: { broadcast: { self: true } } });
  chanP2.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (change) => {
      console.log('[P2 channel] received row type:', change.new.type);
      if (change.new.type === 'start') p2SawStart = change.new.payload;
    });

  await new Promise((resolve) => {
    let subscribed = 0;
    const check = () => { subscribed++; if (subscribed === 2) resolve(); };
    chanP1.subscribe((status) => { if (status === 'SUBSCRIBED') check(); });
    chanP2.subscribe((status) => { if (status === 'SUBSCRIBED') check(); });
  });
  console.log('Both channels SUBSCRIBED.');

  console.log('\n=== P1 (host) calls /rooms/ready FIRST ===');
  const ready1 = await apiPost(t1, '/rooms/ready', { roomCode });
  console.log('P1 HTTP response:', JSON.stringify(ready1).slice(0, 150));

  console.log('\n=== P2 (guest) calls /rooms/ready SECOND (should trigger start) ===');
  const ready2 = await apiPost(t2, '/rooms/ready', { roomCode });
  console.log('P2 HTTP response started:', ready2.started, '| firstTurn:', ready2.firstTurn);

  console.log('\n=== Waiting up to 5s for P1 to receive the start row via Realtime ===');
  await new Promise((r) => setTimeout(r, 5000));

  console.log('\n=== RESULTS ===');
  console.log('P1 (readied first, got started:false directly) saw start via Realtime:', !!p1SawStart);
  console.log('P2 (readied second, got started:true directly) saw start via Realtime:', !!p2SawStart);

  if (p1SawStart) {
    console.log('\nP1 payload.players:', JSON.stringify(p1SawStart.players));
  } else {
    console.log('\n*** BUG CONFIRMED: P1 never received the start event via Realtime. ***');
    console.log('*** P1 relies entirely on _startReadyPolling() (polls every 1.5s, up to 60s). ***');
  }

  process.exit(p1SawStart ? 0 : 2);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

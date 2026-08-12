/* ==========================================================================
   ArenaX — tests the WAITING player's real code path, which
   test-pool-e2e.js/test-pool-shot.js both bypassed by hardcoding the roomId
   from the second player's /matchmaking/join response.

   The first player to queue gets {matched:false} and then discovers the match
   by POLLING /matchmaking/status. online-mode.js then calls:
       socketClient.joinGame(roomCode, gameKey, resp.room?.id)
   and socket-client.js only subscribes to room_events AT ALL if that roomId
   is truthy:
       if (roomId) { channel.on('postgres_changes', {filter:`room_id=eq.${roomId}`}) }

   So if /matchmaking/status omits room.id, the waiting player silently gets
   NO authoritative event subscription — the match can still *start* (via the
   /rooms/sync ready-polling fallback) but that player will never receive a
   single opponent action afterwards. That looks exactly like "freezes after
   the first shot."

   Usage: node scripts/test-p1-path.js
   ========================================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API = 'http://localhost:5000/api';

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

async function apiGet(token, endpoint) {
  const res = await fetch(`${API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

async function main() {
  const t1 = await login('chesstester1@test.local', 'Test1234!');
  const t2 = await login('chesstester2@test.local', 'Test1234!');

  await apiPost(t1, '/matchmaking/leave', {});
  await apiPost(t2, '/matchmaking/leave', {});

  console.log('=== P1 joins queue first (gets matched:false, must poll) ===');
  const join1 = await apiPost(t1, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  console.log('P1 join response matched:', join1.matched);

  console.log('\n=== P2 joins (claims P1, creates the room) ===');
  const join2 = await apiPost(t2, '/matchmaking/join', { gameKey: '8ball-pool', wager: 0 });
  console.log('P2 join matched:', join2.matched, '| P2 room.id:', join2.room?.id);
  const realRoomId = join2.room?.id;

  console.log('\n=== P1 now polls /matchmaking/status — THE UNTESTED PATH ===');
  const status1 = await apiGet(t1, '/matchmaking/status?gameKey=8ball-pool');
  console.log('P1 status full response:');
  console.log(JSON.stringify(status1, null, 2));

  console.log('\n=== VERDICT ===');
  const p1RoomId = status1.room?.id;
  console.log('P1 got room.id from /status :', p1RoomId);
  console.log('Actual room id             :', realRoomId);

  if (!p1RoomId) {
    console.log('\n*** BUG CONFIRMED ***');
    console.log('P1 (the waiting player) receives NO room.id from /matchmaking/status.');
    console.log('=> socket-client.js joinGame() skips the postgres_changes subscription');
    console.log('=> P1 never receives ANY opponent action for the whole match.');
    process.exit(2);
  }
  if (p1RoomId !== realRoomId) {
    console.log('\n*** BUG CONFIRMED: room id MISMATCH ***');
    console.log('P1 subscribes to the WRONG room_id, so its filter never matches.');
    process.exit(3);
  }
  console.log('\nP1 room.id is present and correct — this path is NOT the bug.');
  process.exit(0);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });

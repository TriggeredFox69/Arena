/* ==========================================================================
   ArenaX — verify Supabase Realtime raw `broadcast` delivery between two anon
   clients on the same channel. This is the transport PoolOnline uses for the
   high-frequency ball-position stream (socketClient.broadcastAction / the
   'game:action' broadcast event) — distinct from the room_events
   postgres_changes path already verified for chess. Broadcasts are pure
   peer-to-peer over the channel and never touch the database, so this needs
   its own check.

   Usage: node scripts/test-broadcast.js <ROOM_CODE>
   ========================================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@supabase', 'supabase-js'));

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const roomCode = process.argv[2];

if (!url || !anonKey) {
  console.error('[broadcast-test] SUPABASE_URL / SUPABASE_ANON_KEY missing');
  process.exit(1);
}
if (!roomCode) {
  console.error('[broadcast-test] usage: node scripts/test-broadcast.js <ROOM_CODE>');
  process.exit(1);
}

// Two independent anon clients — simulates the two players' browsers.
const clientA = createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 60 } } });
const clientB = createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 60 } } });

const channelName = `room:${roomCode}`;
let received = 0;

const chanB = clientB.channel(channelName, { config: { broadcast: { self: true } } });
chanB.on('broadcast', { event: 'game:action' }, ({ payload }) => {
  received++;
  console.log('[broadcast-test] ✅ B received:', JSON.stringify(payload.action));
});

chanB.subscribe((status) => {
  console.log('[broadcast-test] B channel status:', status);
  if (status !== 'SUBSCRIBED') return;

  const chanA = clientA.channel(channelName, { config: { broadcast: { self: true } } });
  chanA.subscribe(async (statusA) => {
    if (statusA !== 'SUBSCRIBED') return;
    console.log('[broadcast-test] A channel status:', statusA);
    console.log('[broadcast-test] A sending 5 simulated position-sync broadcasts...');

    for (let i = 0; i < 5; i++) {
      await chanA.send({
        type: 'broadcast',
        event: 'game:action',
        payload: { action: { type: 'sync', frame: i, balls: [{ number: 0, x: 100 + i, y: 250 }] }, by: 'clientA' }
      });
      await new Promise((r) => setTimeout(r, 60));
    }

    setTimeout(() => {
      if (received >= 4) {
        console.log(`\n[broadcast-test] PASS — B received ${received}/5 broadcasts (some drop is normal for fire-and-forget).`);
        process.exit(0);
      } else {
        console.error(`\n[broadcast-test] FAIL — B only received ${received}/5. Broadcast delivery is unreliable or misconfigured.`);
        process.exit(2);
      }
    }, 1500);
  });
});

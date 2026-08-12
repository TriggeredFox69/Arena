/* ==========================================================================
   ArenaX — verify Supabase Realtime delivers room_events to an ANON client.

   This is the exact path js/socket-client.js uses in the browser: subscribe to
   postgres_changes INSERTs on public.room_events with the anon key. If the RLS
   policy from migration 004 is missing, the subscription connects but no rows
   ever arrive — which is what silently broke online play before.

   Usage: node scripts/test-realtime.js <ROOM_ID>
   ========================================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@supabase', 'supabase-js'));

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const roomId = process.argv[2];

if (!url || !anonKey) {
  console.error('[realtime-test] SUPABASE_URL / SUPABASE_ANON_KEY missing');
  process.exit(1);
}
if (!roomId) {
  console.error('[realtime-test] usage: node scripts/test-realtime.js <ROOM_ID>');
  process.exit(1);
}

// Anon client — same credentials the browser gets.
const anon = createClient(url, anonKey, {
  realtime: { params: { eventsPerSecond: 60 } }
});
// Service client only used to write the test event (the backend's role).
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

let received = 0;

const channel = anon.channel(`room:realtime-test`);

channel
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
    (change) => {
      received++;
      console.log('[realtime-test] ✅ RECEIVED event via Realtime:', {
        type: change.new.type,
        payload: change.new.payload
      });
    }
  )
  .subscribe(async (status) => {
    console.log('[realtime-test] channel status:', status);

    if (status === 'SUBSCRIBED') {
      console.log('[realtime-test] subscribed as ANON. Inserting a test event as service role...');

      // Give the subscription a moment to be fully registered server-side.
      await new Promise((r) => setTimeout(r, 1000));

      const { error } = await admin.from('room_events').insert({
        room_id: roomId,
        type: 'sync',
        payload: { probe: 'realtime-delivery-test', at: new Date().toISOString() }
      });

      if (error) {
        console.error('[realtime-test] insert failed:', error.message);
        process.exit(1);
      }
      console.log('[realtime-test] insert OK — waiting up to 8s for delivery...');

      setTimeout(() => {
        if (received > 0) {
          console.log(`\n[realtime-test] PASS — anon client received ${received} event(s).`);
          console.log('Realtime delivery works; the opponent\'s browser will see moves.');
          process.exit(0);
        } else {
          console.error('\n[realtime-test] FAIL — no events delivered to the anon client.');
          console.error('The RLS SELECT policy on public.room_events is likely missing.');
          console.error('Run supabase/migrations/004_chess_online_fixes.sql in the SQL Editor.');
          process.exit(2);
        }
      }, 8000);
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error('[realtime-test] channel failed:', status);
      process.exit(1);
    }
  });

/* ==========================================================================
   ArenaX — verifies the ordering fix.

   BEFORE: 'sync' went over raw broadcast (~50ms) while 'shot_result' went
   over REST->DB->Realtime (~850ms). Different transports, no ordering
   guarantee => ~17 sync packets landed AFTER the shot_result, re-introducing
   moving balls on the watcher's own turn (see test-transport-race.js).

   AFTER: 'shot_result' is ALSO broadcast on the same channel as the syncs.
   Same channel == guaranteed FIFO ordering, so the result can never be
   overtaken by a position packet from the shot it concludes.

   This replays a realistic shot (shot_started, 20 syncs, shot_result) exactly
   as pool-online.js now emits it, and asserts the watcher observes
   shot_result LAST.

   Usage: node scripts/test-race-fixed.js
   ========================================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@supabase', 'supabase-js'));

const SUPA_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ROOM = 'racetest-' + process.pid;

async function main() {
  const watcher = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });
  const shooter = createClient(SUPA_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 60 } } });

  const received = [];

  const wChan = watcher.channel(`room:${ROOM}`, { config: { broadcast: { self: true } } });
  wChan.on('broadcast', { event: 'game:action' }, ({ payload }) => {
    received.push(payload.action.type === 'sync'
      ? `sync#${payload.action.seq}`
      : payload.action.type);
  });

  const sChan = shooter.channel(`room:${ROOM}`, { config: { broadcast: { self: true } } });

  await new Promise((resolve) => {
    let n = 0; const done = () => { if (++n === 2) resolve(); };
    wChan.subscribe((s) => { if (s === 'SUBSCRIBED') done(); });
    sChan.subscribe((s) => { if (s === 'SUBSCRIBED') done(); });
  });
  console.log('Both channels subscribed. Replaying a realistic shot...\n');

  const send = (action) => sChan.send({ type: 'broadcast', event: 'game:action', payload: { action, by: 'shooter' } });

  // Exactly the sequence pool-online.js now emits for one shot.
  send({ type: 'shot_started', angle: 3.14, power: 18 });
  for (let i = 1; i <= 20; i++) {
    send({ type: 'sync', seq: i, balls: [{ number: 0, x: 100 + i, y: 100, vx: 9 - i * 0.4, vy: 0, isPocketed: false }] });
  }
  send({ type: 'shot_result', shotId: 'shooter:1', nextTurn: 2, keepTurn: false, ballInHand: false, finalBalls: [] });

  await new Promise((r) => setTimeout(r, 4000));

  console.log('Watcher received ' + received.length + ' packets.');
  console.log('First 3 :', received.slice(0, 3).join(', '));
  console.log('Last 3  :', received.slice(-3).join(', '));

  const resultIdx = received.indexOf('shot_result');
  const lastSyncIdx = received.map((r, i) => (r.startsWith('sync') ? i : -1)).filter(i => i >= 0).pop();

  console.log('\nshot_result index :', resultIdx);
  console.log('last sync index   :', lastSyncIdx);

  console.log('\n=== VERDICT ===');
  if (resultIdx === -1) { console.log('FAIL: shot_result never arrived.'); process.exit(2); }
  if (resultIdx < lastSyncIdx) {
    console.log('FAIL: a sync landed AFTER shot_result — race still open.');
    process.exit(3);
  }
  console.log('PASS: shot_result arrived AFTER every sync packet.');
  console.log('The watcher can no longer be handed a moving table on its own turn.');
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });

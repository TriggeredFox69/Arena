/**
 * Single shared Supabase browser client.
 *
 * Everything that needs auth or data (js/api.js, js/p2p.js) goes through
 * getSupabase() so there is exactly one session and one realtime socket.
 */
(function () {
  'use strict';

  let client = null;

  window.getSupabase = function getSupabase() {
    if (client) return client;

    const cfg = window.ARENAX_CONFIG || {};
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      console.warn('[supabase] not configured -- run `node scripts/inject-env.js`');
      return null;
    }

    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'arenax_sb_auth'
      }
    });
    window.sb = client;
    return client;
  };
})();

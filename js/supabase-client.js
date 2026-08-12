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

    const cfg = window.ARENAX_SUPABASE_CONFIG || window.ARENAX_CONFIG || {};
    const url = cfg.url || cfg.SUPABASE_URL;
    const key = cfg.anonKey || cfg.SUPABASE_ANON_KEY;
    if (!window.supabase || !url || !key) {
      console.warn('[supabase] not configured -- check supabase-config.js');
      return null;
    }

    client = window.supabase.createClient(url, key, {
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

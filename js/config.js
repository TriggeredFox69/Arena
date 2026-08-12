// ==========================================
// ArenaX Configuration
// Server URLs, Supabase settings, game lists
// ==========================================

(function () {
  'use strict';

  // Base URL of this script (used to load generated config relative to the page)
  const currentScript = document.currentScript;
  const jsBase = currentScript
    ? currentScript.src.replace(/\\/g, '/').replace(/\/[^\/]*$/, '/')
    : (function () {
        const path = window.location.pathname;
        return path.endsWith('/') ? path : path.replace(/\/[^\/]*$/, '/');
      })();

  // Game keys supported for online play
  const GAME_KEYS = ['ludo', 'chess', 'checkers', '8ball-pool', 'pool', 'carrom', 'glowhockey'];

  // Game display names
  const GAME_NAMES = {
    carrom: 'Carrom Clash',
    ludo: 'Ludo Stars',
    '8ball-pool': '8 Ball Pool',
    pool: '8 Ball Pool',
    'Glow-hockey': 'Glow Hockey',
    glowhockey: 'Glow Hockey',
    chess: 'Chess Royale',
    checkers: 'Checkers Clash'
  };

  // Turn timeout per game (seconds)
  const TURN_TIMEOUTS = {
    chess: 30,
    checkers: 20,
    ludo: 30,
    '8ball-pool': 45,
    pool: 45,
    carrom: 0,      // shooter-authoritative physics (see rooms-supabase.js)
    glowhockey: 0   // real-time, no turn timeout
  };

  // Load a script dynamically and return a promise
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve(s);
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  window.ARENAX_CONFIG = {
    GAME_KEYS,
    GAME_NAMES,
    TURN_TIMEOUTS,

    // Get the backend server URL
    // Netlify Dev serves the API from the same origin on port 8888.
    // The standalone backend on port 3000/5000 is legacy and no longer used.
    getServerUrl() {
      const host = window.location.hostname;
      const port = window.location.port;
      const isLocal = host === 'localhost' || host === '127.0.0.1';

      if (isLocal) {
        if (port === '8888' || port === '') return ''; // Netlify Dev: same origin
        if (port === '5000') return '';                // Express serves frontend + /api same origin
        return 'http://localhost:5000';                // File opened another way → hit backend directly
      }
      // Production: Netlify Functions are proxied by netlify.toml redirects
      return '';
    },

    // Get the API base URL
    getApiBase() {
      const serverUrl = this.getServerUrl();
      return serverUrl ? `${serverUrl}/api` : '/api';
    },

    // Get game key from file name
    getGameKey(filename) {
      const key = filename.replace(/^.*[\\/]/, '').replace(/\.html?$/, '').toLowerCase();
      if (GAME_KEYS.includes(key)) return key;
      if (key === '8ball-pool' || key === 'pool') return 'pool';
      if (key === 'glow-hockey') return 'glowhockey';
      return key;
    },

    // Get or create the Supabase anon client. Returns a Promise<SupabaseClient>.
    // Loads the generated config and the Supabase UMD bundle on demand.
    async getSupabaseClient() {
      if (this._supabaseClient) return this._supabaseClient;

      if (!window.ARENAX_SUPABASE_CONFIG) {
        try {
          await loadScript(jsBase + 'supabase-config.js');
        } catch (e) {
          console.warn('[ARENAX_CONFIG] Could not load supabase-config.js:', e.message);
        }
      }

      const cfg = window.ARENAX_SUPABASE_CONFIG || {};
      if (!cfg.url || !cfg.anonKey) {
        throw new Error('Supabase URL/anon key not configured. Run scripts/inject-env.js or set SUPABASE_URL/SUPABASE_ANON_KEY.');
      }

      if (!window.supabase || !window.supabase.createClient) {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
      }

      this._supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        },
        realtime: {
          params: {
            eventsPerSecond: 60
          }
        }
      });

      return this._supabaseClient;
    }
  };
})();

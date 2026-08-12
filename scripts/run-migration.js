/* ==========================================================================
   ArenaX — apply a .sql migration to Supabase over the Postgres REST endpoint.

   Supabase's JS client cannot execute arbitrary DDL, so this posts the SQL to
   the project's `/database/query` management endpoint using the service-role
   key. Usage:

     node scripts/run-migration.js supabase/migrations/005_fix_matchmaking_rpc.sql

   Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the repo-root .env.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('[run-migration] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('[run-migration] usage: node scripts/run-migration.js <path-to.sql>');
  process.exit(1);
}

const sqlPath = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
if (!fs.existsSync(sqlPath)) {
  console.error('[run-migration] file not found:', sqlPath);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

// The service-role JWT's "ref" claim identifies the project.
function projectRef() {
  try {
    const payload = JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64').toString('utf8'));
    return payload.ref;
  } catch (e) {
    return null;
  }
}

async function main() {
  const ref = projectRef();
  console.log('[run-migration] applying', path.basename(sqlPath), ref ? `to project ${ref}` : '');

  // exec_sql is a helper RPC (created on first use below) that runs raw SQL.
  const rpcUrl = `${url.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`;
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ query: sql })
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[run-migration] FAILED (HTTP ${res.status})`);
    console.error(text);
    console.error('\nIf the error mentions exec_sql not existing, run this once in the');
    console.error('Supabase SQL Editor, then re-run this script:\n');
    console.error(`  create or replace function public.exec_sql(query text)`);
    console.error(`  returns void language plpgsql security definer as $$`);
    console.error(`  begin execute query; end; $$;`);
    process.exit(1);
  }

  console.log('[run-migration] OK', text ? `— ${text}` : '');
}

main().catch((err) => {
  console.error('[run-migration] error:', err.message);
  process.exit(1);
});

# ArenaX - Netlify + Supabase Deployment Guide

This guide moves the ArenaX frontend and backend from a local Node/Express/SQLite stack to a serverless setup on Netlify with a Supabase Postgres database.

## What changed

- **Frontend**: static files deployed by Netlify.
- **Backend**: converted to Netlify Functions (`netlify/functions/api.js`).
- **Database**: SQLite replaced by Supabase Postgres.
- **Models**: `User`, `Transaction`, and `GameHistory` now query Supabase via the service-role key.
- **Real-time chat/rooms**: Socket.IO removed because Netlify Functions cannot hold persistent WebSocket connections. Wire Supabase Realtime later if you need live chat.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project.
2. Copy the **Project URL**, **service role key**, and **anon key** from Settings > API.
3. Open the Supabase SQL Editor and run the full migration in `supabase/migrations/001_initial.sql`.

## 2. Prepare this repo for Netlify

1. Install dependencies at the repo root:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` (for local Netlify dev only) and fill in the values:

   ```bash
   cp .env.example .env
   ```

3. Set the same environment variables in the Netlify dashboard under **Site settings > Environment variables**:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY`
   - `JWT_SECRET` (a long random string)
   - `JWT_EXPIRE` (e.g. `7d`)
   - `COIN_PRICE` (e.g. `10`)
   - `FRONTEND_URL` (your Netlify site URL)

## 3. Local test with Netlify CLI

```bash
npm run dev
```

This starts the Netlify dev server. Open the printed URL and test:

- `GET /api/health` should return `{ "status": "ok" }`.
- Register a user at `POST /api/auth/register`.
- Login at `POST /api/auth/login`.

## 4. Deploy to Netlify

### Option A: Git-based deploy (recommended)

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Netlify, choose **Add new site > Import an existing project**.
3. Select the repo and branch.
4. Build command: leave blank or use `npm run build`.
5. Publish directory: `.` (root of the repo).
6. Add the environment variables from step 2.
7. Deploy.

### Option B: Manual deploy

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=.
```

Set the environment variables in the Netlify dashboard first.

## 5. Verify after deploy

1. Open `https://your-site.netlify.app/login.html` and register.
2. Check Supabase Table Editor to confirm the `users` row was created.
3. Test deposit/withdraw and game history via the UI.

## Migrated features

- User registration/login (`/api/auth/*`)
- Wallet balance/deposit/withdraw/transactions (`/api/wallet/*`)
- Game start/end/history/stats (`/api/games/*`)

## Not yet migrated

These features still use localStorage mock data or the local event bus:

- Friends (add/accept/list)
- Marketplace (orders/trades)
- Chat rooms
- USDT buy/withdraw
- Real-time game invites

To add them, create Supabase tables matching the existing schemas and add the corresponding routes to `netlify/functions/api.js`. For real-time, replace the local event bus in `js/socket-client.js` with a Supabase Realtime channel.

## Troubleshooting

- **Function build errors**: make sure the root `package.json` has all dependencies listed.
- **CORS errors**: check that `FRONTEND_URL` matches your Netlify domain and that the `cors()` middleware is enabled in `netlify/functions/api.js`.
- **Supabase 401 errors**: confirm `SUPABASE_SERVICE_ROLE_KEY` is set, not the anon key, for backend functions.
- **JWT errors**: ensure `JWT_SECRET` is set and is the same for login and protected routes.

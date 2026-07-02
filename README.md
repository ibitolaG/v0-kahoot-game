# CCI Leeds Quiz Arena

A real-time multiplayer quiz game, built in the style of Kahoot with Next.js and Supabase.

## What it does

- Hosts live quiz games with a join PIN
- Supports classic solo play and team play with team codes
- Lets players join, answer questions, reconnect, and see scores live
- Includes host screens, leaderboards, breaks, and podium results
- Uses Supabase SQL migrations in `scripts/`

## Tech stack

- Next.js
- React
- Supabase
- Tailwind CSS
- Vercel cron for the keepalive route

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Environment variables

Create a local env file with:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Database

Run the numbered SQL files in `scripts/` in order inside the Supabase SQL editor.

`vercel.json` pings `/api/keepalive` daily so the Supabase free tier database does not pause.

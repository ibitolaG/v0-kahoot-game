# CCI Leeds Quiz Arena

A real-time multiplayer quiz game (Kahoot-style) built with [Next.js](https://nextjs.org) and [Supabase](https://supabase.com).

## Features

- Host live quiz games with a join PIN
- **Classic mode** (everyone plays for themselves) or **Team mode** (players join with a team code)
- Real-time gameplay with a polling fallback so weak connections keep working
- Live scoreboards, leaderboard breaks, and podium finishes
- Player reconnection — refreshing or dropping out doesn't lose progress

## Getting Started

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Database setup

Migrations live in `scripts/` as numbered SQL files. Run them in order in the Supabase SQL editor. The `/api/keepalive` route is pinged daily by a Vercel cron (see `vercel.json`) to stop the Supabase free tier from pausing the database.

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

-- Adds a per-game mode so hosts can run Kahoot-style Classic (individual)
-- games or Team games. Existing games keep team behaviour.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'team';

ALTER TABLE public.games
  DROP CONSTRAINT IF EXISTS games_mode_check;

ALTER TABLE public.games
  ADD CONSTRAINT games_mode_check CHECK (mode IN ('classic', 'team'));

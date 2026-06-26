ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS team_code TEXT NOT NULL DEFAULT 'GENERAL';

UPDATE public.players
SET team_code = 'GENERAL'
WHERE team_code IS NULL OR btrim(team_code) = '';

CREATE INDEX IF NOT EXISTS players_game_team_code_idx
  ON public.players (game_id, team_code);

ALTER TABLE public.games
  DROP COLUMN IF EXISTS max_players;

NOTIFY pgrst, 'reload schema';

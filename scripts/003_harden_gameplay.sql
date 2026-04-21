ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS max_players INTEGER NOT NULL DEFAULT 50;

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS reconnect_token UUID UNIQUE;

DROP POLICY IF EXISTS "players_insert" ON public.players;
DROP POLICY IF EXISTS "players_update" ON public.players;
DROP POLICY IF EXISTS "players_delete" ON public.players;

CREATE POLICY "players_insert_host" ON public.players FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.games WHERE games.id = players.game_id AND games.host_id = auth.uid())
);

CREATE POLICY "players_update_host" ON public.players FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.games WHERE games.id = players.game_id AND games.host_id = auth.uid())
);

CREATE POLICY "players_delete_host" ON public.players FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.games WHERE games.id = players.game_id AND games.host_id = auth.uid())
);

DROP POLICY IF EXISTS "answers_insert" ON public.answers;

CREATE POLICY "answers_insert_host" ON public.answers FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.players
    JOIN public.games ON games.id = players.game_id
    WHERE players.id = answers.player_id AND games.host_id = auth.uid()
  )
);

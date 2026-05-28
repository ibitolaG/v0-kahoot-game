-- Optional performance cleanup for Supabase advisors.
-- Adds foreign-key indexes used by joins/RLS and avoids per-row auth.uid()
-- re-evaluation in row level security policies.

CREATE INDEX IF NOT EXISTS quizzes_host_id_idx ON public.quizzes (host_id);
CREATE INDEX IF NOT EXISTS questions_quiz_id_idx ON public.questions (quiz_id);
CREATE INDEX IF NOT EXISTS games_quiz_id_idx ON public.games (quiz_id);
CREATE INDEX IF NOT EXISTS games_host_id_idx ON public.games (host_id);
CREATE INDEX IF NOT EXISTS players_game_id_idx ON public.players (game_id);
CREATE INDEX IF NOT EXISTS answers_question_id_idx ON public.answers (question_id);

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING ((select auth.uid()) = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK ((select auth.uid()) = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "quizzes_select_own" ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_insert_own" ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_update_own" ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_delete_own" ON public.quizzes;
CREATE POLICY "quizzes_select_own" ON public.quizzes FOR SELECT USING ((select auth.uid()) = host_id);
CREATE POLICY "quizzes_insert_own" ON public.quizzes FOR INSERT WITH CHECK ((select auth.uid()) = host_id);
CREATE POLICY "quizzes_update_own" ON public.quizzes FOR UPDATE USING ((select auth.uid()) = host_id) WITH CHECK ((select auth.uid()) = host_id);
CREATE POLICY "quizzes_delete_own" ON public.quizzes FOR DELETE USING ((select auth.uid()) = host_id);

DROP POLICY IF EXISTS "questions_insert" ON public.questions;
DROP POLICY IF EXISTS "questions_update" ON public.questions;
DROP POLICY IF EXISTS "questions_delete" ON public.questions;
CREATE POLICY "questions_insert" ON public.questions FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = (select auth.uid())
  )
);
CREATE POLICY "questions_update" ON public.questions FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = (select auth.uid())
  )
) WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = (select auth.uid())
  )
);
CREATE POLICY "questions_delete" ON public.questions FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS "games_insert_host" ON public.games;
DROP POLICY IF EXISTS "games_update_host" ON public.games;
DROP POLICY IF EXISTS "games_delete_host" ON public.games;
CREATE POLICY "games_insert_host" ON public.games FOR INSERT WITH CHECK ((select auth.uid()) = host_id);
CREATE POLICY "games_update_host" ON public.games FOR UPDATE USING ((select auth.uid()) = host_id) WITH CHECK ((select auth.uid()) = host_id);
CREATE POLICY "games_delete_host" ON public.games FOR DELETE USING ((select auth.uid()) = host_id);

DROP POLICY IF EXISTS "players_insert_host" ON public.players;
DROP POLICY IF EXISTS "players_update_host" ON public.players;
DROP POLICY IF EXISTS "players_delete_host" ON public.players;
CREATE POLICY "players_insert_host" ON public.players FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = (select auth.uid())
  )
);
CREATE POLICY "players_update_host" ON public.players FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = (select auth.uid())
  )
) WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = (select auth.uid())
  )
);
CREATE POLICY "players_delete_host" ON public.players FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS "answers_insert_host" ON public.answers;
CREATE POLICY "answers_insert_host" ON public.answers FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.players
    JOIN public.games ON games.id = players.game_id
    WHERE players.id = answers.player_id
      AND games.host_id = (select auth.uid())
  )
);

NOTIFY pgrst, 'reload schema';

-- Repair / bootstrap script for the QuizBlitz Supabase database.
-- Safe to run more than once. It creates missing objects, refreshes policies,
-- grants Data API access to the roles used by the app, and reloads PostgREST.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  break_interval INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS break_interval INTEGER NOT NULL DEFAULT 4;

CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false')),
  options JSONB NOT NULL,
  time_limit INTEGER NOT NULL DEFAULT 20,
  points INTEGER NOT NULL DEFAULT 1000,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'question', 'results', 'finished')),
  current_question_index INTEGER DEFAULT 0,
  question_start_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.games
  DROP COLUMN IF EXISTS max_players;

CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  reconnect_token UUID UNIQUE,
  score INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS reconnect_token UUID UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS players_reconnect_token_key
  ON public.players (reconnect_token)
  WHERE reconnect_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_option INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  time_taken INTEGER NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, question_id)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS private.handle_new_user();

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_user();

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "quizzes_select_own" ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_insert_own" ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_update_own" ON public.quizzes;
DROP POLICY IF EXISTS "quizzes_delete_own" ON public.quizzes;
CREATE POLICY "quizzes_select_own" ON public.quizzes FOR SELECT USING (auth.uid() = host_id);
CREATE POLICY "quizzes_insert_own" ON public.quizzes FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "quizzes_update_own" ON public.quizzes FOR UPDATE USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "quizzes_delete_own" ON public.quizzes FOR DELETE USING (auth.uid() = host_id);

DROP POLICY IF EXISTS "questions_select" ON public.questions;
DROP POLICY IF EXISTS "questions_select_public" ON public.questions;
DROP POLICY IF EXISTS "questions_insert" ON public.questions;
DROP POLICY IF EXISTS "questions_update" ON public.questions;
DROP POLICY IF EXISTS "questions_delete" ON public.questions;
CREATE POLICY "questions_select_public" ON public.questions FOR SELECT USING (true);
CREATE POLICY "questions_insert" ON public.questions FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = auth.uid()
  )
);
CREATE POLICY "questions_update" ON public.questions FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = auth.uid()
  )
);
CREATE POLICY "questions_delete" ON public.questions FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes
    WHERE quizzes.id = questions.quiz_id
      AND quizzes.host_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "games_select_host" ON public.games;
DROP POLICY IF EXISTS "games_select_public" ON public.games;
DROP POLICY IF EXISTS "games_insert_host" ON public.games;
DROP POLICY IF EXISTS "games_update_host" ON public.games;
DROP POLICY IF EXISTS "games_delete_host" ON public.games;
CREATE POLICY "games_select_public" ON public.games FOR SELECT USING (true);
CREATE POLICY "games_insert_host" ON public.games FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "games_update_host" ON public.games FOR UPDATE USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "games_delete_host" ON public.games FOR DELETE USING (auth.uid() = host_id);

DROP POLICY IF EXISTS "players_select" ON public.players;
DROP POLICY IF EXISTS "players_insert" ON public.players;
DROP POLICY IF EXISTS "players_update" ON public.players;
DROP POLICY IF EXISTS "players_delete" ON public.players;
DROP POLICY IF EXISTS "players_insert_host" ON public.players;
DROP POLICY IF EXISTS "players_update_host" ON public.players;
DROP POLICY IF EXISTS "players_delete_host" ON public.players;
CREATE POLICY "players_select" ON public.players FOR SELECT USING (true);
CREATE POLICY "players_insert_host" ON public.players FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = auth.uid()
  )
);
CREATE POLICY "players_update_host" ON public.players FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = auth.uid()
  )
);
CREATE POLICY "players_delete_host" ON public.players FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM public.games
    WHERE games.id = players.game_id
      AND games.host_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "answers_select" ON public.answers;
DROP POLICY IF EXISTS "answers_insert" ON public.answers;
DROP POLICY IF EXISTS "answers_insert_host" ON public.answers;
CREATE POLICY "answers_select" ON public.answers FOR SELECT USING (true);
CREATE POLICY "answers_insert_host" ON public.answers FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.players
    JOIN public.games ON games.id = players.game_id
    WHERE players.id = answers.player_id
      AND games.host_id = auth.uid()
  )
);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.games, public.players, public.questions, public.answers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles,
  public.quizzes,
  public.questions,
  public.games,
  public.players,
  public.answers
TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'games'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'answers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

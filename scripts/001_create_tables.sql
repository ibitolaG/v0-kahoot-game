-- QuizBlitz Database Schema
-- Tables for hosts, quizzes, questions, games, players, and scores

-- Profiles table for hosts (links to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Quizzes table
CREATE TABLE IF NOT EXISTS public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quizzes_select_own" ON public.quizzes FOR SELECT USING (auth.uid() = host_id);
CREATE POLICY "quizzes_insert_own" ON public.quizzes FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "quizzes_update_own" ON public.quizzes FOR UPDATE USING (auth.uid() = host_id);
CREATE POLICY "quizzes_delete_own" ON public.quizzes FOR DELETE USING (auth.uid() = host_id);

-- Questions table
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false')),
  options JSONB NOT NULL, -- Array of options: [{text: string, isCorrect: boolean}]
  time_limit INTEGER NOT NULL DEFAULT 20, -- seconds
  points INTEGER NOT NULL DEFAULT 1000,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "questions_select" ON public.questions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.host_id = auth.uid())
);
-- Allow players (unauthenticated) to read questions during gameplay
CREATE POLICY "questions_select_public" ON public.questions FOR SELECT USING (true);
CREATE POLICY "questions_insert" ON public.questions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.host_id = auth.uid())
);
CREATE POLICY "questions_update" ON public.questions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.host_id = auth.uid())
);
CREATE POLICY "questions_delete" ON public.questions FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.host_id = auth.uid())
);

-- Games table (active game sessions)
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

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- Hosts can manage their games
CREATE POLICY "games_select_host" ON public.games FOR SELECT USING (auth.uid() = host_id);
CREATE POLICY "games_insert_host" ON public.games FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "games_update_host" ON public.games FOR UPDATE USING (auth.uid() = host_id);
CREATE POLICY "games_delete_host" ON public.games FOR DELETE USING (auth.uid() = host_id);
-- Allow public read for players to join via PIN
CREATE POLICY "games_select_public" ON public.games FOR SELECT USING (true);

-- Players table (anonymous players in a game)
CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  reconnect_token UUID UNIQUE,
  score INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- Public access for players
CREATE POLICY "players_select" ON public.players FOR SELECT USING (true);
CREATE POLICY "players_insert_host" ON public.players FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.games WHERE games.id = players.game_id AND games.host_id = auth.uid())
);
CREATE POLICY "players_update_host" ON public.players FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.games WHERE games.id = players.game_id AND games.host_id = auth.uid())
);
CREATE POLICY "players_delete_host" ON public.players FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.games WHERE games.id = players.game_id AND games.host_id = auth.uid())
);

-- Answers table (player responses)
CREATE TABLE IF NOT EXISTS public.answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_option INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  time_taken INTEGER NOT NULL, -- milliseconds
  points_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, question_id)
);

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "answers_select" ON public.answers FOR SELECT USING (true);
CREATE POLICY "answers_insert_host" ON public.answers FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.players
    JOIN public.games ON games.id = players.game_id
    WHERE players.id = answers.player_id AND games.host_id = auth.uid()
  )
);

-- Enable realtime for games and players
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;

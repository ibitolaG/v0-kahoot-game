-- Fix: Allow players (unauthenticated) to read questions during gameplay.
-- The original policy only allowed quiz hosts to read questions,
-- blocking players from seeing question content entirely.
CREATE POLICY "questions_select_public" ON public.questions FOR SELECT USING (true);

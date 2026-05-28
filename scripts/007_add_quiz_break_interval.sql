ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS break_interval INTEGER NOT NULL DEFAULT 4;

UPDATE public.quizzes
SET break_interval = 4
WHERE break_interval IS NULL;

NOTIFY pgrst, 'reload schema';

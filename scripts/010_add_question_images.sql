-- Optional image per question, stored in a public Supabase Storage bucket.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "question_images_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'question-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "question_images_auth_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'question-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "question_images_auth_delete" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'question-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

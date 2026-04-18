import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { QuizBuilder } from '@/components/quiz-builder'

export default async function CreateQuizPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  return <QuizBuilder userId={user.id} />
}

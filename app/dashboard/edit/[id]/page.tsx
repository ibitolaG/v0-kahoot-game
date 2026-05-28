import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { QuizBuilder } from '@/components/quiz-builder'
import type { Question } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: quiz } = await supabase
    .from('quizzes')
    .select('*, questions(*)')
    .eq('id', id)
    .eq('host_id', user.id)
    .single()

  if (!quiz) {
    notFound()
  }

  // Sort questions by order_index
  const sortedQuestions = (quiz.questions as Question[] | undefined)?.sort((a, b) => a.order_index - b.order_index) || []

  return <QuizBuilder userId={user.id} existingQuiz={{ ...quiz, questions: sortedQuestions }} />
}

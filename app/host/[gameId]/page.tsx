import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HostGameClient } from './host-game-client'
import type { Question } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function HostGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: game } = await supabase
    .from('games')
    .select('*, quiz:quizzes(*, questions(*))')
    .eq('id', gameId)
    .eq('host_id', user.id)
    .single()

  if (!game) {
    notFound()
  }

  // Sort questions by order_index
  if (game.quiz?.questions) {
    ;(game.quiz.questions as Question[]).sort((a, b) => a.order_index - b.order_index)
  }

  return <HostGameClient initialGame={game} />
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculatePoints } from '@/lib/gameplay'
import type { Question, QuestionOption } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const playerId = String(body.playerId || '').trim()
    const selectedOption = Number(body.selectedOption)

    if (!playerId || !Number.isInteger(selectedOption)) {
      return NextResponse.json({ error: 'Player and selected option are required.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, score, game_id')
      .eq('id', playerId)
      .single()

    if (playerError || !player) {
      return NextResponse.json({ error: 'Player not found.' }, { status: 404 })
    }

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id, status, quiz_id, current_question_index, question_start_time')
      .eq('id', player.game_id)
      .single()

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found.' }, { status: 404 })
    }

    if (game.status !== 'question' || !game.question_start_time) {
      return NextResponse.json({ error: 'Answers are closed right now.' }, { status: 409 })
    }

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', game.quiz_id)
      .order('order_index')

    if (questionsError || !questions?.length) {
      return NextResponse.json({ error: 'Questions could not be loaded.' }, { status: 500 })
    }

    const currentQuestion = questions[game.current_question_index] as Question | undefined

    if (!currentQuestion) {
      return NextResponse.json({ error: 'Current question was not found.' }, { status: 404 })
    }

    const { data: existingAnswer } = await supabase
      .from('answers')
      .select('id')
      .eq('player_id', player.id)
      .eq('question_id', currentQuestion.id)
      .maybeSingle()

    if (existingAnswer) {
      return NextResponse.json({ error: 'You already answered this question.' }, { status: 409 })
    }

    const timeTaken = Math.floor(
      (Date.now() - new Date(game.question_start_time).getTime()) / 1000
    )

    const { isCorrect, pointsEarned } = calculatePoints(
      currentQuestion.options as QuestionOption[],
      selectedOption,
      currentQuestion.time_limit,
      timeTaken,
      currentQuestion.points
    )

    const { error: answerError } = await supabase.from('answers').insert({
      player_id: player.id,
      question_id: currentQuestion.id,
      selected_option: selectedOption,
      is_correct: isCorrect,
      time_taken: timeTaken,
      points_earned: pointsEarned,
    })

    if (answerError) {
      return NextResponse.json({ error: 'Failed to store answer.' }, { status: 500 })
    }

    const updatedScore = player.score + pointsEarned

    if (isCorrect) {
      const { error: playerUpdateError } = await supabase
        .from('players')
        .update({ score: updatedScore })
        .eq('id', player.id)

      if (playerUpdateError) {
        return NextResponse.json({ error: 'Failed to update player score.' }, { status: 500 })
      }
    }

    return NextResponse.json({
      correct: isCorrect,
      points: pointsEarned,
      score: updatedScore,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to submit answer.' },
      { status: 500 }
    )
  }
}

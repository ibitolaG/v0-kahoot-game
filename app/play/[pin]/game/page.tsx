'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Zap, Loader2, Trophy, Clock, CheckCircle, XCircle } from 'lucide-react'
import type { Game, Player, Question, QuestionOption } from '@/lib/types'

export default function PlayerGamePage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = use(params)
  const searchParams = useSearchParams()
  const playerId = searchParams.get('player')
  
  const [game, setGame] = useState<Game | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [hasAnswered, setHasAnswered] = useState(false)
  const [lastAnswer, setLastAnswer] = useState<{ correct: boolean; points: number } | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [players, setPlayers] = useState<Player[]>([])
  
  const router = useRouter()
  const supabase = createClient()

  // Initial data fetch
  useEffect(() => {
    if (!playerId) {
      router.push(`/play/${pin}`)
      return
    }

    const fetchData = async () => {
      // Get game
      const { data: gameData } = await supabase
        .from('games')
        .select('*, quiz:quizzes(*, questions(*))')
        .eq('pin', pin.toUpperCase())
        .single()

      if (!gameData) {
        router.push('/')
        return
      }

      // Get player
      const { data: playerData } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single()

      if (!playerData) {
        router.push(`/play/${pin}`)
        return
      }

      const sortedQuestions = gameData.quiz?.questions?.sort((a: Question, b: Question) => a.order_index - b.order_index) || []
      
      setGame(gameData)
      setPlayer(playerData)
      setQuestions(sortedQuestions)
      setCurrentQuestion(sortedQuestions[gameData.current_question_index])
      setLoading(false)
    }

    fetchData()
  }, [playerId, pin, supabase, router])

  // Subscribe to game updates
  useEffect(() => {
    if (!game) return

    const channel = supabase
      .channel('game-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${game.id}` },
        (payload) => {
          const updatedGame = payload.new as Game
          setGame(prev => prev ? { ...prev, ...updatedGame } : null)
          
          if (updatedGame.status === 'question') {
            setCurrentQuestion(questions[updatedGame.current_question_index])
            setSelectedOption(null)
            setHasAnswered(false)
            setLastAnswer(null)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'games', filter: `id=eq.${game.id}` },
        () => {
          // Game ended
          router.push('/')
        }
      )
      .subscribe()

    // Subscribe to player updates for scoreboard
    const playersChannel = supabase
      .channel('players-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${game.id}` },
        async () => {
          const { data } = await supabase
            .from('players')
            .select('*')
            .eq('game_id', game.id)
            .order('score', { ascending: false })
          if (data) setPlayers(data)
          
          // Update current player score
          const updatedPlayer = data?.find(p => p.id === playerId)
          if (updatedPlayer) setPlayer(updatedPlayer)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(playersChannel)
    }
  }, [game, questions, playerId, supabase, router])

  // Timer countdown
  useEffect(() => {
    if (game?.status !== 'question' || !game.question_start_time || !currentQuestion) return

    const startTime = new Date(game.question_start_time).getTime()
    const timeLimit = currentQuestion.time_limit

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, timeLimit - elapsed)
      setTimeLeft(remaining)
    }, 100)

    return () => clearInterval(interval)
  }, [game?.status, game?.question_start_time, currentQuestion])

  const submitAnswer = useCallback(async (optionIndex: number) => {
    if (hasAnswered || !currentQuestion || !player || !game?.question_start_time) return

    setSelectedOption(optionIndex)
    setHasAnswered(true)

    const options = currentQuestion.options as QuestionOption[]
    const isCorrect = options[optionIndex]?.isCorrect || false
    const timeTaken = Math.floor((Date.now() - new Date(game.question_start_time).getTime()) / 1000)
    
    // Calculate points (faster = more points)
    const timeBonus = Math.max(0, currentQuestion.time_limit - timeTaken)
    const pointsEarned = isCorrect ? Math.floor(currentQuestion.points * (0.5 + (timeBonus / currentQuestion.time_limit) * 0.5)) : 0

    // Submit answer
    await supabase.from('answers').insert({
      player_id: player.id,
      question_id: currentQuestion.id,
      selected_option: optionIndex,
      is_correct: isCorrect,
      time_taken: timeTaken,
      points_earned: pointsEarned,
    })

    // Update player score
    if (isCorrect) {
      await supabase
        .from('players')
        .update({ score: player.score + pointsEarned })
        .eq('id', player.id)
    }

    setLastAnswer({ correct: isCorrect, points: pointsEarned })
  }, [hasAnswered, currentQuestion, player, game?.question_start_time, supabase])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (!game || !player) {
    return null
  }

  const optionColors = [
    'bg-red-500 hover:bg-red-600 active:bg-red-700',
    'bg-blue-500 hover:bg-blue-600 active:bg-blue-700',
    'bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700',
    'bg-green-500 hover:bg-green-600 active:bg-green-700',
  ]

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-card/50 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-bold">{player.nickname}</span>
          </div>
          <div className="text-primary font-bold">
            {player.score.toLocaleString()} pts
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        {game.status === 'waiting' && (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Zap className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">You&apos;re in!</h2>
            <p className="text-muted-foreground">Waiting for the host to start the game...</p>
          </div>
        )}

        {game.status === 'question' && currentQuestion && !hasAnswered && (
          <div className="w-full max-w-lg">
            {/* Timer */}
            <div className="text-center mb-4">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary ${
                timeLeft !== null && timeLeft <= 5 ? 'text-primary animate-timer-pulse' : ''
              }`}>
                <Clock className="h-5 w-5" />
                <span className="text-2xl font-bold font-mono">{timeLeft ?? '--'}</span>
              </div>
            </div>

            {/* Question text */}
            <div className="bg-card/50 border border-border rounded-xl px-5 py-4 mb-5 text-center">
              <p className="text-lg font-semibold">{currentQuestion.question_text}</p>
            </div>

            {/* Options */}
            <div className="grid grid-cols-2 gap-3">
              {(currentQuestion.options as QuestionOption[]).map((option, index) => (
                <button
                  key={index}
                  onClick={() => submitAnswer(index)}
                  className={`${optionColors[index]} p-6 rounded-xl text-white font-bold text-lg transition-all active:scale-95 flex items-center justify-center min-h-[100px]`}
                >
                  <span className="text-center">{option.text || String.fromCharCode(65 + index)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {game.status === 'question' && hasAnswered && lastAnswer && (
          <div className="text-center">
            {lastAnswer.correct ? (
              <>
                <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
                <h2 className="text-3xl font-bold text-green-500 mb-2">Correct!</h2>
                <p className="text-2xl font-bold">+{lastAnswer.points.toLocaleString()} pts</p>
              </>
            ) : (
              <>
                <XCircle className="h-20 w-20 text-destructive mx-auto mb-4" />
                <h2 className="text-3xl font-bold text-destructive mb-2">Wrong!</h2>
                <p className="text-muted-foreground">Better luck next time</p>
              </>
            )}
          </div>
        )}

        {game.status === 'results' && (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Results</h2>
            <Card className="bg-card/50">
              <CardContent className="py-6">
                <div className="text-4xl font-bold text-primary mb-2">
                  {player.score.toLocaleString()}
                </div>
                <p className="text-muted-foreground">Your total score</p>
              </CardContent>
            </Card>
          </div>
        )}

        {game.status === 'finished' && (
          <div className="w-full max-w-md text-center">
            <Trophy className="h-16 w-16 text-quiz-gold mx-auto mb-4" />
            <h2 className="text-3xl font-bold mb-2">Game Over!</h2>
            
            <Card className="bg-card/50 mb-6">
              <CardContent className="py-6">
                <div className="text-sm text-muted-foreground mb-1">Your final score</div>
                <div className="text-4xl font-bold text-primary">
                  {player.score.toLocaleString()}
                </div>
                <div className="text-muted-foreground mt-2">
                  Position: #{players.findIndex(p => p.id === player.id) + 1} of {players.length}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50">
              <CardContent className="py-4">
                <h3 className="font-semibold mb-3">Final Standings</h3>
                <div className="space-y-2">
                  {players.slice(0, 5).map((p, index) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between py-2 px-3 rounded ${
                        p.id === player.id ? 'bg-primary/10' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${
                          index === 0 ? 'text-quiz-gold' :
                          index === 1 ? 'text-quiz-silver' :
                          index === 2 ? 'text-quiz-bronze' : ''
                        }`}>
                          #{index + 1}
                        </span>
                        <span className={p.id === player.id ? 'font-bold' : ''}>
                          {p.nickname}
                        </span>
                      </div>
                      <span className="text-muted-foreground">
                        {p.score.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}

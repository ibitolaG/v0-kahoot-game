'use client'

import { useState, useEffect, use, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Zap, Loader2, Trophy, Clock, CheckCircle, XCircle } from 'lucide-react'
import type { Game, Player, Question, QuestionOption } from '@/lib/types'
import { Brand } from '@/components/brand'

export default function PlayerGamePage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = use(params)
  const searchParams = useSearchParams()
  const playerId = searchParams.get('player')

  const [game, setGame] = useState<Game | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [hasAnswered, setHasAnswered] = useState(false)
  const [lastAnswer, setLastAnswer] = useState<{ correct: boolean; points: number } | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [players, setPlayers] = useState<Player[]>([])

  const router = useRouter()
  const supabase = useRef(createClient()).current

  // Derive currentQuestion from game state — no stale closure possible
  const currentQuestion: Question | null = game
    ? (questions[game.current_question_index] ?? null)
    : null

  // Initial data fetch
  useEffect(() => {
    if (!playerId) {
      router.push(`/play/${pin}`)
      return
    }

    const fetchData = async () => {
      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .select('*')
        .eq('pin', pin.toUpperCase())
        .single()

      if (gameError || !gameData) {
        setError(`Game not found (${gameError?.message ?? 'no data'})`)
        setLoading(false)
        return
      }

      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single()

      if (playerError || !playerData) {
        router.push(`/play/${pin}`)
        return
      }

      // Fetch questions directly — avoids nested join RLS issues
      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('*')
        .eq('quiz_id', gameData.quiz_id)
        .order('order_index')

      if (questionsError) {
        setError(`Could not load questions (${questionsError.message})`)
        setLoading(false)
        return
      }

      const { data: playersData } = await supabase
        .from('players')
        .select('*')
        .eq('game_id', gameData.id)
        .order('score', { ascending: false })

      setGame(gameData)
      setPlayer(playerData)
      setQuestions(questionsData ?? [])
      setPlayers(playersData ?? [])
      setLoading(false)
    }

    fetchData()
  }, [playerId, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to game updates
  useEffect(() => {
    if (!game) return

    const gameId = game.id

    const channel = supabase
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          const updatedGame = payload.new as Game
          setGame(prev => prev ? { ...prev, ...updatedGame } : null)
          if (updatedGame.status === 'question') {
            setSelectedOption(null)
            setHasAnswered(false)
            setLastAnswer(null)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.push('/')
      )
      .subscribe()

    const playersChannel = supabase
      .channel(`players-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
        async () => {
          const { data } = await supabase
            .from('players')
            .select('*')
            .eq('game_id', gameId)
            .order('score', { ascending: false })
          if (data) {
            setPlayers(data)
            const updatedPlayer = data.find(p => p.id === playerId)
            if (updatedPlayer) setPlayer(updatedPlayer)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(playersChannel)
    }
  }, [game?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer countdown
  useEffect(() => {
    if (game?.status !== 'question' || !game.question_start_time || !currentQuestion) return

    const startTime = new Date(game.question_start_time).getTime()
    const timeLimit = currentQuestion.time_limit

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setTimeLeft(Math.max(0, timeLimit - elapsed))
    }, 100)

    return () => clearInterval(interval)
  }, [game?.status, game?.question_start_time, currentQuestion?.id])

  const submitAnswer = useCallback(async (optionIndex: number) => {
    if (hasAnswered || !currentQuestion || !player || !game?.question_start_time) return

    setSelectedOption(optionIndex)
    setHasAnswered(true)

    const options = currentQuestion.options as QuestionOption[]
    const fallbackCorrect = options[optionIndex]?.isCorrect || false
    setLastAnswer({
      correct: fallbackCorrect,
      points: 0,
    })

    const response = await fetch('/api/play/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: player.id,
        selectedOption: optionIndex,
      }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      setHasAnswered(false)
      setSelectedOption(null)
      setLastAnswer(null)
      setError(data?.error || 'Failed to submit answer.')
      return
    }

    const updatedScore = typeof data?.score === 'number'
      ? data.score
      : player.score + (typeof data?.points === 'number' ? data.points : 0)

    setPlayer(prev => prev ? { ...prev, score: updatedScore } : prev)
    setLastAnswer({
      correct: typeof data?.correct === 'boolean' ? data.correct : fallbackCorrect,
      points: typeof data?.points === 'number' ? data.points : 0,
    })
  }, [hasAnswered, currentQuestion, player, game?.question_start_time, supabase])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-destructive mb-2 font-semibold">Could not load game</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </main>
    )
  }

  if (!game || !player) return null

  const optionColors = [
    'bg-red-500 hover:bg-red-600 active:bg-red-700',
    'bg-blue-500 hover:bg-blue-600 active:bg-blue-700',
    'bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700',
    'bg-green-500 hover:bg-green-600 active:bg-green-700',
  ]

  return (
    <main className="min-h-screen flex flex-col">
      <header className="bg-card/50 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brand showText={false} logoClassName="h-6 w-auto" />
            <span className="font-bold">{player.nickname}</span>
          </div>
          <div className="text-primary font-bold">
            {player.score.toLocaleString()} pts
          </div>
        </div>
      </header>

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
            <div className="text-center mb-4">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary ${
                timeLeft !== null && timeLeft <= 5 ? 'text-primary animate-timer-pulse' : ''
              }`}>
                <Clock className="h-5 w-5" />
                <span className="text-2xl font-bold font-mono">{timeLeft ?? '--'}</span>
              </div>
            </div>

            <div className="bg-card/50 border border-border rounded-xl px-5 py-4 mb-5 text-center">
              <p className="text-lg font-semibold">{currentQuestion.question_text}</p>
            </div>

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

        {game.status === 'question' && !currentQuestion && (
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p>Loading question...</p>
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
          <div className="w-full max-w-lg">
            <div className="text-center mb-6">
              {lastAnswer ? (
                lastAnswer.correct ? (
                  <>
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-3" />
                    <h2 className="text-3xl font-bold text-green-500 mb-2">Correct!</h2>
                    <p className="text-lg text-muted-foreground">+{lastAnswer.points.toLocaleString()} points</p>
                  </>
                ) : (
                  <>
                    <XCircle className="h-16 w-16 text-destructive mx-auto mb-3" />
                    <h2 className="text-3xl font-bold text-destructive mb-2">Wrong answer</h2>
                    <p className="text-lg text-muted-foreground">The correct answer is highlighted below.</p>
                  </>
                )
              ) : (
                <>
                  <h2 className="text-3xl font-bold mb-2">Round Results</h2>
                  <p className="text-muted-foreground">Review the correct answer before the next question starts.</p>
                </>
              )}
            </div>

            {currentQuestion && (
              <>
                <div className="bg-card/50 border border-border rounded-xl px-5 py-4 mb-5 text-center">
                  <p className="text-lg font-semibold">{currentQuestion.question_text}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  {(currentQuestion.options as QuestionOption[]).map((option, index) => {
                    const isCorrect = option.isCorrect
                    const isSelected = selectedOption === index
                    const cardClass = isCorrect
                      ? 'border-green-500 bg-green-500 text-white'
                      : isSelected
                        ? 'border-destructive bg-destructive text-white'
                        : 'border-border bg-secondary'

                    return (
                      <div
                        key={index}
                        className={`rounded-xl border-2 p-5 ${cardClass}`}
                      >
                        <div className="mb-2 text-sm font-bold">{String.fromCharCode(65 + index)}</div>
                        <div className="font-semibold">{option.text}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <Card className="bg-card/50">
              <CardContent className="py-6">
                <div className="text-4xl font-bold text-primary mb-2 text-center">
                  {player.score.toLocaleString()}
                </div>
                <p className="text-muted-foreground text-center">Your total score</p>
              </CardContent>
            </Card>
          </div>
        )}

                {game.status === 'playing' && (
          <div className="w-full max-w-4xl text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
              <Trophy className="h-12 w-12 text-amber-300" />
            </div>
            <h2 className="text-4xl font-black mb-2">Leaderboard Break</h2>
            <p className="text-muted-foreground mb-6">See where you stand before the next section starts.</p>

            <Card className="border-border/60 bg-gradient-to-b from-card to-card/70 shadow-[0_0_60px_rgba(239,0,0,0.14)]">
              <CardContent className="py-6">
                <div className="space-y-3">
                  {players.slice(0, 5).map((p, index) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
                        index === 0
                          ? 'border-amber-300/50 bg-amber-300/15'
                          : index === 1
                            ? 'border-slate-300/40 bg-slate-200/10'
                            : index === 2
                              ? 'border-orange-400/40 bg-orange-500/10'
                              : p.id === player.id
                                ? 'border-primary/40 bg-primary/10'
                                : 'border-border bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-12 text-2xl font-black ${
                          index === 0 ? 'text-amber-300' :
                          index === 1 ? 'text-slate-200' :
                          index === 2 ? 'text-orange-300' : 'text-primary'
                        }`}>
                          #{index + 1}
                        </span>
                        <span className={`text-xl ${p.id === player.id ? 'font-black text-white' : 'font-bold text-zinc-100'}`}>{p.nickname}</span>
                      </div>
                      <span className="text-xl font-bold text-zinc-100">{p.score.toLocaleString()} pts</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {game.status === 'finished' && (
          <div className="w-full max-w-5xl text-center">
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
              <Trophy className="h-14 w-14 text-amber-300" />
            </div>
            <h2 className="text-5xl font-black mb-3">Game Over!</h2>

            <Card className="mb-6 border-border/60 bg-card/70">
              <CardContent className="py-6">
                <div className="text-sm text-muted-foreground mb-1">Your final score</div>
                <div className="text-5xl font-black text-primary">
                  {player.score.toLocaleString()}
                </div>
                <div className="text-lg text-muted-foreground mt-2">
                  Position: #{players.findIndex(p => p.id === player.id) + 1} of {players.length}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-gradient-to-b from-card to-card/70 shadow-[0_0_90px_rgba(239,0,0,0.16)]">
              <CardContent className="py-8">
                <div className="mb-5">
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-6 py-2 text-lg font-semibold text-amber-200">
                    Winner: {players[0]?.nickname ?? 'TBD'}
                  </span>
                </div>

                <div className="mb-10 flex justify-center items-end gap-5">
                  {[1, 0, 2].map((position) => {
                    const p = players[position]
                    if (!p) return null
                    const heightsByRank = ['h-60', 'h-44', 'h-36']
                    const stylesByRank = [
                      'from-amber-300 via-yellow-400 to-orange-500 text-slate-950',
                      'from-slate-200 to-slate-500 text-slate-950',
                      'from-orange-300 to-amber-700 text-slate-950',
                    ]

                    return (
                      <div key={p.id} className="flex w-36 flex-col items-center text-center">
                        <div className="mb-3">
                          <div className={`text-3xl font-black ${position === 0 ? 'text-amber-300' : 'text-white'}`}>
                            {position === 0 ? 'WINNER' : `#${position + 1}`}
                          </div>
                          <div className="mt-1 text-2xl font-bold text-white">{p.nickname}</div>
                          <div className="text-base text-zinc-300">{p.score.toLocaleString()} pts</div>
                        </div>
                        <div className={`flex w-full ${heightsByRank[position]} items-end justify-center rounded-t-3xl bg-gradient-to-b ${stylesByRank[position]} pb-4 shadow-xl`}>
                          <span className="text-5xl font-black">{position + 1}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mx-auto max-w-3xl space-y-3">
                  {players.slice(0, 5).map((p, index) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
                        index === 0
                          ? 'border-amber-300/50 bg-amber-300/15'
                          : index === 1
                            ? 'border-slate-300/40 bg-slate-200/10'
                            : index === 2
                              ? 'border-orange-400/40 bg-orange-500/10'
                              : p.id === player.id
                                ? 'border-primary/40 bg-primary/10'
                                : 'border-border bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-12 text-2xl font-black ${
                          index === 0 ? 'text-amber-300' :
                          index === 1 ? 'text-slate-200' :
                          index === 2 ? 'text-orange-300' : 'text-primary'
                        }`}>
                          #{index + 1}
                        </span>
                        <span className={`text-xl ${p.id === player.id ? 'font-black text-white' : 'font-bold text-zinc-100'}`}>{p.nickname}</span>
                      </div>
                      <span className="text-xl font-bold text-zinc-100">{p.score.toLocaleString()} pts</span>
                    </div>
                  ))}
                </div>

                <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-primary/30 bg-primary/10 px-5 py-4 text-left">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">Your position</div>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <span className="text-xl font-bold text-white">
                      #{players.findIndex(p => p.id === player.id) + 1} of {players.length}
                    </span>
                    <span className="text-lg font-semibold text-zinc-200">{player.score.toLocaleString()} pts</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}

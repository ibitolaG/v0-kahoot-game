'use client'

import { useState, useEffect, use, useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Zap, Loader2, Trophy, Clock, CheckCircle, XCircle, WifiOff, Lock } from 'lucide-react'
import type { Game, Player, Question, QuestionOption } from '@/lib/types'
import { Brand } from '@/components/brand'
import { AnswerShape } from '@/components/answer-shape'
import { ThemeToggle } from '@/components/theme-toggle'
import { getPlayerTeamCode, getTeamStandings, isTeamMode } from '@/lib/gameplay'

// Retries transient network failures so a dropped connection doesn't lose the answer.
async function fetchWithRetry(input: RequestInfo, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(input, init)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

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
  const [submittingAnswer, setSubmittingAnswer] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [connectionLost, setConnectionLost] = useState(false)

  const router = useRouter()
  const supabase = useRef(createClient()).current
  const cacheKey = `quizblitz:${pin.toUpperCase()}:${playerId}:game-cache`

  // Derive currentQuestion from game state — no stale closure possible
  const currentQuestion: Question | null = game
    ? (questions[game.current_question_index] ?? null)
    : null
  const teamMode = isTeamMode(game)
  const teamStandings = useMemo(() => getTeamStandings(players), [players])

  // Initial data fetch
  useEffect(() => {
    if (!playerId) {
      router.push(`/play/${pin}`)
      return
    }

    // Render instantly from the local cache while the network catches up, so
    // questions still show on a bad connection or after a reload.
    const loadCache = () => {
      try {
        const cached = localStorage.getItem(cacheKey)
        if (!cached) return false
        const parsed = JSON.parse(cached) as { game: Game; player: Player; questions: Question[]; players: Player[] }
        if (!parsed.game || !parsed.player || !parsed.questions?.length) return false
        if (parsed.game.status === 'question') {
          lastQuestionKeyRef.current = `${parsed.game.current_question_index}`
        }
        setGame(parsed.game)
        setPlayer(parsed.player)
        setQuestions(parsed.questions)
        setPlayers(parsed.players ?? [])
        setLoading(false)
        return true
      } catch {
        return false
      }
    }

    const hadCache = loadCache()

    const fetchData = async () => {
      try {
        const { data: gameData, error: gameError } = await supabase
          .from('games')
          .select('*')
          .eq('pin', pin.toUpperCase())
          .single()

        if (gameError || !gameData) {
          if (!hadCache) {
            setError(`Game not found (${gameError?.message ?? 'no data'})`)
            setLoading(false)
          }
          return
        }

        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('*')
          .eq('id', playerId)
          .single()

        if (playerError || !playerData) {
          if (!hadCache) router.push(`/play/${pin}`)
          return
        }

        // Fetch questions directly — avoids nested join RLS issues
        const { data: questionsData, error: questionsError } = await supabase
          .from('questions')
          .select('*')
          .eq('quiz_id', gameData.quiz_id)
          .order('order_index')

        if (questionsError) {
          if (!hadCache) {
            setError(`Could not load questions (${questionsError.message})`)
            setLoading(false)
          }
          return
        }

        const { data: playersData } = await supabase
          .from('players')
          .select('*')
          .eq('game_id', gameData.id)
          .order('score', { ascending: false })

        if (gameData.status === 'question') {
          lastQuestionKeyRef.current = `${gameData.current_question_index}`
        }
        setGame(gameData)
        setPlayer(playerData)
        setQuestions(questionsData ?? [])
        setPlayers(playersData ?? [])
        setLoading(false)

        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            game: gameData,
            player: playerData,
            questions: questionsData ?? [],
            players: playersData ?? [],
          }))
        } catch {
          // Cache is best-effort; ignore storage failures
        }
      } catch {
        if (!hadCache) {
          setError('Could not reach the server. Check your connection and refresh.')
          setLoading(false)
        }
      }
    }

    fetchData()
  }, [playerId, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset answer state exactly once per new question, whether the update
  // arrived via realtime or the polling fallback.
  const lastQuestionKeyRef = useRef<string | null>(null)

  const applyGameUpdate = useCallback((updatedGame: Game) => {
    if (updatedGame.status === 'question') {
      // Key by index only — the host can shift question_start_time mid-question
      // to shorten the timer, and that must not reset answer state.
      const questionKey = `${updatedGame.current_question_index}`
      if (lastQuestionKeyRef.current !== questionKey) {
        lastQuestionKeyRef.current = questionKey
        setSelectedOption(null)
        setHasAnswered(false)
        setLastAnswer(null)
        setSubmittingAnswer(false)
        setAnswerError(null)
      }
    }
    setGame(prev => prev ? { ...prev, ...updatedGame } : updatedGame)
  }, [])

  const refreshPlayers = useCallback(async (gameId: string) => {
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
  }, [playerId, supabase])

  // Subscribe to game updates
  useEffect(() => {
    if (!game) return

    const gameId = game.id

    const channel = supabase
      .channel(`game-${gameId}`)
      // Fast path: the host broadcasts state changes directly — these arrive
      // in well under a second, unlike postgres_changes on the free tier.
      .on(
        'broadcast',
        { event: 'game_update' },
        (message) => applyGameUpdate(message.payload as Game)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => applyGameUpdate(payload.new as Game)
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.push('/')
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionLost(false)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnectionLost(true)
        }
      })

    const playersChannel = supabase
      .channel(`players-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
        () => refreshPlayers(gameId)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(playersChannel)
    }
  }, [game?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling fallback — keeps the game moving even when realtime is down or
  // the network is flaky. Cheap single-row read every few seconds.
  useEffect(() => {
    if (!game?.id) return

    const gameId = game.id
    let tick = 0
    let cancelled = false

    const refresh = async () => {
      try {
        const { data, error: pollError } = await supabase
          .from('games')
          .select('*')
          .eq('id', gameId)
          .maybeSingle()

        if (cancelled) return

        if (pollError) {
          // Network hiccup or paused database — keep the current question on
          // screen and try again on the next tick.
          setConnectionLost(true)
          return
        }

        if (!data) {
          // Game row is gone — host ended the game
          router.push('/')
          return
        }

        setConnectionLost(false)
        applyGameUpdate(data as Game)

        // Refresh scores occasionally and whenever standings are on screen
        tick++
        const status = (data as Game).status
        if (status === 'playing' || status === 'results' || status === 'finished' || tick % 3 === 0) {
          await refreshPlayers(gameId)
        }
      } catch {
        if (!cancelled) setConnectionLost(true)
      }
    }

    // Poll faster on the waiting screen so the first question appears quickly
    // even if the realtime push is missed.
    const pollMs = game.status === 'waiting' ? 1500 : 2500
    const interval = setInterval(refresh, pollMs)

    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    const onOffline = () => setConnectionLost(true)
    window.addEventListener('offline', onOffline)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('offline', onOffline)
    }
  }, [game?.id, game?.status, applyGameUpdate, refreshPlayers, router, supabase])

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
    setSubmittingAnswer(true)
    setAnswerError(null)

    const options = currentQuestion.options as QuestionOption[]
    const fallbackCorrect = options[optionIndex]?.isCorrect || false

    let response: Response
    try {
      response = await fetchWithRetry('/api/play/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: player.id,
          selectedOption: optionIndex,
        }),
      })
    } catch {
      setHasAnswered(false)
      setSelectedOption(null)
      setLastAnswer(null)
      setSubmittingAnswer(false)
      setAnswerError('Connection lost — your answer did not go through. Tap an answer to try again.')
      return
    }

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      setHasAnswered(false)
      setSelectedOption(null)
      setLastAnswer(null)
      setSubmittingAnswer(false)
      setAnswerError(data?.error || 'Failed to submit answer.')
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
    setSubmittingAnswer(false)
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
  const playerTeamCode = getPlayerTeamCode(player)
  const playerTeamRank = teamStandings.findIndex((team) => team.code === playerTeamCode) + 1
  const playerRank = players.findIndex(p => p.id === player.id) + 1
  const podiumEntries = teamMode
    ? teamStandings.slice(0, 3).map((team) => ({
        id: team.code,
        name: team.code,
        detail: `${team.averageScore.toLocaleString()} avg pts`,
      }))
    : players.slice(0, 3).map((p) => ({
        id: p.id,
        name: p.nickname,
        detail: `${p.score.toLocaleString()} pts`,
      }))

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
            <div>
              <div className="font-bold leading-tight">{player.nickname}</div>
              {teamMode && (
                <div className="font-mono text-xs text-muted-foreground">{playerTeamCode}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="text-primary font-bold">
              {player.score.toLocaleString()} pts
            </div>
            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </header>

      {connectionLost && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-sm text-amber-500">
          <WifiOff className="h-4 w-4" />
          <span>Weak connection — reconnecting. Keep playing, your answers will still count.</span>
        </div>
      )}

      <div className="flex-1 flex items-center justify-center p-4">
        {game.status === 'waiting' && (
          <div className="text-center animate-pop-in">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 animate-pulse-glow">
              <Zap className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">You&apos;re in!</h2>
            <p className="text-muted-foreground">Waiting for the host to start the game...</p>
          </div>
        )}

        {game.status === 'question' && currentQuestion && !hasAnswered && (
          <div className="w-full max-w-lg animate-slide-up" key={currentQuestion.id}>
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
              {currentQuestion.image_url && (
                <div className="mt-3 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentQuestion.image_url}
                    alt="Question illustration"
                    className="max-h-44 rounded-lg border border-border object-contain"
                  />
                </div>
              )}
            </div>

            {answerError && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
                {answerError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {(currentQuestion.options as QuestionOption[]).map((option, index) => (
                <button
                  key={index}
                  onClick={() => submitAnswer(index)}
                  className={`${optionColors[index]} animate-pop-in stagger-${index + 1} p-5 rounded-xl text-white font-bold text-lg transition-transform active:scale-95 flex flex-col items-center justify-center gap-2 min-h-[100px] shadow-lg`}
                >
                  <AnswerShape index={index} className="h-6 w-6 opacity-90" />
                  <span className="text-center leading-tight">{option.text || String.fromCharCode(65 + index)}</span>
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

        {/* No right/wrong reveal here — everyone finds out together on the
            results screen, Kahoot-style. */}
        {game.status === 'question' && hasAnswered && (
          <div className="text-center animate-pop-in">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 animate-pulse-glow">
              <Lock className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-3xl font-bold mb-2">Answer locked in!</h2>
            <p className="text-muted-foreground">
              {submittingAnswer ? 'Sending your answer...' : "You'll see how you did when the time is up."}
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2">
              <Clock className="h-4 w-4" />
              <span className="font-mono font-bold">{timeLeft ?? '--'}</span>
            </div>
          </div>
        )}

        {game.status === 'results' && (
          <div className="w-full max-w-lg animate-slide-up">
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
                        <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                          <AnswerShape index={index} className="h-4 w-4" />
                          {String.fromCharCode(65 + index)}
                        </div>
                        <div className="font-semibold">{option.text}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <Card className="bg-card/50">
              <CardContent className="py-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">
                  {player.score.toLocaleString()}
                </div>
                <p className="text-muted-foreground">Your total score</p>
                {playerRank > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-5 py-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <span className="font-bold">
                      You&apos;re #{playerRank} of {players.length}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {game.status === 'playing' && (
          <div className="w-full max-w-4xl text-center animate-slide-up">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
              <Trophy className="h-12 w-12 text-amber-600 dark:text-amber-300" />
            </div>
            <h2 className="text-4xl font-black mb-2">Leaderboard Break</h2>
            <p className="text-muted-foreground mb-4">
              {teamMode ? 'Team standings first, individual standings just below.' : 'Top players so far.'}
            </p>

            {playerRank > 0 && (
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-6 py-3 animate-pop-in">
                <Trophy className="h-5 w-5 text-primary" />
                <span className="text-lg font-bold">
                  You&apos;re #{playerRank} of {players.length}
                </span>
                {teamMode && playerTeamRank > 0 && (
                  <span className="text-sm text-muted-foreground">
                    &middot; Team {playerTeamCode} #{playerTeamRank}
                  </span>
                )}
              </div>
            )}

            <Card className="border-border/60 bg-gradient-to-b from-card to-card/70 shadow-[0_0_60px_rgba(239,0,0,0.14)]">
              <CardContent className="py-6">
                {teamMode && (
                <div className="mb-6 space-y-3">
                  {teamStandings.slice(0, 5).map((team, index, list) => (
                    <div
                      key={team.code}
                      style={{ animationDelay: `${(list.length - 1 - index) * 0.35 + 0.2}s` }}
                      className={`animate-leaderboard-in flex items-center justify-between rounded-2xl border px-5 py-4 ${
                        index === 0
                          ? 'border-amber-300/50 bg-amber-300/15'
                          : index === 1
                            ? 'border-slate-300/40 bg-slate-200/10'
                          : index === 2
                              ? 'border-orange-400/40 bg-orange-500/10'
                              : team.code === playerTeamCode
                                ? 'border-primary/40 bg-primary/10'
                                : 'border-border bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-12 text-2xl font-black ${
                          index === 0 ? 'text-amber-600 dark:text-amber-300' :
                          index === 1 ? 'text-slate-500 dark:text-slate-200' :
                          index === 2 ? 'text-orange-600 dark:text-orange-300' : 'text-primary'
                        }`}>
                          #{index + 1}
                        </span>
                        <div className="text-left">
                          <div className={`text-xl ${team.code === playerTeamCode ? 'font-black text-foreground' : 'font-bold text-foreground/90'}`}>
                            {team.code}
                          </div>
                          <div className="text-sm text-muted-foreground">{team.playerCount} players</div>
                        </div>
                      </div>
                      <span className="text-xl font-bold text-foreground">{team.averageScore.toLocaleString()} avg</span>
                    </div>
                  ))}
                </div>
                )}

                <div className="space-y-3">
                  <div className="text-left text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {teamMode ? 'Individual top 5' : 'Top 5 players'}
                  </div>
                  {players.slice(0, 5).map((p, index, list) => (
                    <div
                      key={p.id}
                      style={{ animationDelay: `${(list.length - 1 - index) * 0.35 + 0.2}s` }}
                      className={`animate-leaderboard-in flex items-center justify-between rounded-2xl border px-5 py-4 ${
                        p.id === player.id ? 'border-primary/40 bg-primary/10' : 'border-border bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="w-12 text-2xl font-black text-primary">#{index + 1}</span>
                        <div className="text-left">
                          <div className={`text-xl ${p.id === player.id ? 'font-black text-foreground' : 'font-bold text-foreground/90'}`}>{p.nickname}</div>
                          {teamMode && <div className="text-sm text-muted-foreground">{getPlayerTeamCode(p)}</div>}
                        </div>
                      </div>
                      <span className="text-xl font-bold text-foreground">{p.score.toLocaleString()} pts</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {game.status === 'finished' && (
          <div className="w-full max-w-5xl text-center animate-slide-up">
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
              <Trophy className="h-14 w-14 text-amber-600 dark:text-amber-300" />
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
                {teamMode && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Team {playerTeamCode}: #{playerTeamRank || '-'} of {teamStandings.length}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-gradient-to-b from-card to-card/70 shadow-[0_0_90px_rgba(239,0,0,0.16)]">
              <CardContent className="py-8">
                <div className="mb-10 flex justify-center items-end gap-5">
                  {[1, 0, 2].map((position) => {
                    const entry = podiumEntries[position]
                    if (!entry) return null
                    const heightsByRank = ['h-60', 'h-44', 'h-36']
                    const stylesByRank = [
                      'from-amber-300 via-yellow-400 to-orange-500 text-slate-950',
                      'from-slate-200 to-slate-500 text-slate-950',
                      'from-orange-300 to-amber-700 text-slate-950',
                    ]

                    return (
                      <div key={entry.id} className="flex w-36 flex-col items-center text-center">
                        <div className="mb-3">
                          <div className={`text-3xl font-black ${position === 0 ? 'text-amber-600 dark:text-amber-300' : 'text-foreground'}`}>
                            {position === 0 ? 'WINNER' : `#${position + 1}`}
                          </div>
                          <div className="mt-1 text-2xl font-bold text-foreground">{entry.name}</div>
                          <div className="text-base text-muted-foreground">{entry.detail}</div>
                        </div>
                        <div className={`flex w-full ${heightsByRank[position]} items-end justify-center rounded-t-3xl bg-gradient-to-b ${stylesByRank[position]} pb-4 shadow-xl animate-podium-rise stagger-${position + 1}`}>
                          <span className="text-5xl font-black">{position + 1}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {teamMode && (
                <div className="mx-auto mb-6 max-w-3xl space-y-3">
                  <div className="text-left text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Team standings
                  </div>
                  {teamStandings.slice(0, 5).map((team, index) => (
                    <div
                      key={team.code}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
                        index === 0
                          ? 'border-amber-300/50 bg-amber-300/15'
                          : index === 1
                            ? 'border-slate-300/40 bg-slate-200/10'
                          : index === 2
                              ? 'border-orange-400/40 bg-orange-500/10'
                              : team.code === playerTeamCode
                                ? 'border-primary/40 bg-primary/10'
                                : 'border-border bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-12 text-2xl font-black ${
                          index === 0 ? 'text-amber-600 dark:text-amber-300' :
                          index === 1 ? 'text-slate-500 dark:text-slate-200' :
                          index === 2 ? 'text-orange-600 dark:text-orange-300' : 'text-primary'
                        }`}>
                          #{index + 1}
                        </span>
                        <div className="text-left">
                          <div className={`text-xl ${team.code === playerTeamCode ? 'font-black text-foreground' : 'font-bold text-foreground/90'}`}>{team.code}</div>
                          <div className="text-sm text-muted-foreground">{team.playerCount} players</div>
                        </div>
                      </div>
                      <span className="text-xl font-bold text-foreground">{team.averageScore.toLocaleString()} avg</span>
                    </div>
                  ))}
                </div>
                )}

                <div className="mx-auto max-w-3xl space-y-3">
                  <div className="text-left text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {teamMode ? 'Individual top 5' : 'Top 5 players'}
                  </div>
                  {players.slice(0, 5).map((p, index) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
                        p.id === player.id ? 'border-primary/40 bg-primary/10' : 'border-border bg-secondary/30'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="w-12 text-2xl font-black text-primary">#{index + 1}</span>
                        <div className="text-left">
                          <div className={`text-xl ${p.id === player.id ? 'font-black text-foreground' : 'font-bold text-foreground/90'}`}>{p.nickname}</div>
                          {teamMode && <div className="text-sm text-muted-foreground">{getPlayerTeamCode(p)}</div>}
                        </div>
                      </div>
                      <span className="text-xl font-bold text-foreground">{p.score.toLocaleString()} pts</span>
                    </div>
                  ))}
                </div>

                <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-primary/30 bg-primary/10 px-5 py-4 text-left">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">Your position</div>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <span className="text-xl font-bold text-foreground">
                      #{players.findIndex(p => p.id === player.id) + 1} of {players.length}
                    </span>
                    <span className="text-lg font-semibold text-foreground">{player.score.toLocaleString()} pts</span>
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

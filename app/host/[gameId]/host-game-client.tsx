'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Zap, Users, Play, ChevronRight, Trophy, X, FastForward, SkipForward } from 'lucide-react'
import type { Game, Player, Question, QuestionOption, Answer } from '@/lib/types'
import { Brand } from '@/components/brand'
import { AnswerShape } from '@/components/answer-shape'
import { ThemeToggle } from '@/components/theme-toggle'
import { getPlayerTeamCode, getTeamStandings, isTeamMode, type TeamStanding } from '@/lib/gameplay'

interface HostGameClientProps {
  initialGame: Game & { 
    quiz: { 
      title: string
      break_interval?: number | null
      questions: Question[] 
    } 
  }
}

export function HostGameClient({ initialGame }: HostGameClientProps) {
  const [game, setGame] = useState(initialGame)
  const [players, setPlayers] = useState<Player[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const questions = game.quiz.questions
  const currentQuestion = questions[game.current_question_index]
  const teamMode = isTeamMode(game)
  const teamStandings = useMemo(() => getTeamStandings(players), [players])
  const breakInterval = Math.max(0, game.quiz.break_interval ?? 4)
  const currentPlayerIds = useMemo(() => new Set(players.map((player) => player.id)), [players])
  const currentGameAnswers = useMemo(() => {
    const latestAnswersByPlayer = new Map<string, Answer>()

    answers.forEach((answer) => {
      if (!currentPlayerIds.has(answer.player_id)) return
      latestAnswersByPlayer.set(answer.player_id, answer)
    })

    return Array.from(latestAnswersByPlayer.values())
  }, [answers, currentPlayerIds])

  const shouldShowLeaderboardBreak = useCallback(
    (nextIndex: number) => breakInterval > 0 && nextIndex > 0 && nextIndex < questions.length && nextIndex % breakInterval === 0,
    [questions.length, breakInterval]
  )

  // Broadcast channel on the same topic players listen to. Broadcast messages
  // arrive in well under a second — much faster than postgres_changes on the
  // free tier — so game state transitions reach players near-instantly.
  const broadcastChannelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const channel = supabase.channel(`game-${game.id}`)
    channel.subscribe()
    broadcastChannelRef.current = channel

    return () => {
      broadcastChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [game.id, supabase])

  const broadcastGameState = useCallback((update: Partial<Game>) => {
    void broadcastChannelRef.current?.send({
      type: 'broadcast',
      event: 'game_update',
      payload: update,
    })
  }, [])

  const fetchPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('game_id', game.id)
      .order('score', { ascending: false })

    if (data) {
      setPlayers(data)
      return data
    }

    return []
  }, [game.id, supabase])

  const fetchAnswers = useCallback(async (questionId?: string, playerIds?: string[]) => {
    if (!questionId) {
      setAnswers([])
      return
    }

    const { data } = await supabase
      .from('answers')
      .select('*')
      .eq('question_id', questionId)
      .order('created_at', { ascending: true })

    if (data) {
      const activePlayerIds = new Set(playerIds ?? players.map((player) => player.id))
      setAnswers(data.filter((answer) => activePlayerIds.has(answer.player_id)))
    }
  }, [players, supabase])

  // Subscribe to realtime updates
  useEffect(() => {
    const bootstrap = async () => {
      const activePlayers = await fetchPlayers()
      await fetchAnswers(currentQuestion?.id, activePlayers.map((player) => player.id))
    }

    bootstrap()

    const playersChannel = supabase
      .channel(`players-${game.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${game.id}` },
        async () => {
          const activePlayers = await fetchPlayers()
          await fetchAnswers(currentQuestion?.id, activePlayers.map((player) => player.id))
        }
      )
      .subscribe()

    const answersChannel = currentQuestion?.id
      ? supabase
          .channel(`answers-${game.id}-${currentQuestion.id}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'answers', filter: `question_id=eq.${currentQuestion.id}` },
            (payload) => {
              const answer = payload.new as Answer
              if (!currentPlayerIds.has(answer.player_id)) return
              setAnswers(prev => prev.some(existing => existing.id === answer.id) ? prev : [...prev, answer])
            }
          )
          .subscribe()
      : null

    return () => {
      supabase.removeChannel(playersChannel)
      if (answersChannel) {
        supabase.removeChannel(answersChannel)
      }
    }
  }, [game.id, supabase, currentQuestion?.id, fetchPlayers, fetchAnswers, currentPlayerIds])

  // Polling fallback — keeps player list and answer counts fresh even if the
  // realtime connection drops.
  useEffect(() => {
    const interval = setInterval(async () => {
      const activePlayers = await fetchPlayers()
      if (game.status === 'question' && currentQuestion?.id) {
        await fetchAnswers(currentQuestion.id, activePlayers.map((player) => player.id))
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [game.status, currentQuestion?.id, fetchPlayers, fetchAnswers])

  // Timer countdown
  useEffect(() => {
    if (game.status !== 'question' || !game.question_start_time) return

    const startTime = new Date(game.question_start_time).getTime()
    const timeLimit = currentQuestion?.time_limit || 20

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, timeLimit - elapsed)
      setTimeLeft(remaining)

      if (remaining === 0) {
        clearInterval(interval)
        showResults()
      }
    }, 100)

    return () => clearInterval(interval)
  }, [game.status, game.question_start_time, currentQuestion?.time_limit])

  const startGame = async () => {
    const timestamp = new Date().toISOString()
    const update = {
      status: 'question' as const,
      current_question_index: 0,
      question_start_time: timestamp,
    }

    await supabase.from('games').update(update).eq('id', game.id)

    broadcastGameState(update)
    setGame(prev => ({ ...prev, ...update }))
    setAnswers([])
    setTimeLeft(currentQuestion?.time_limit || 20)
  }

  const showResults = useCallback(async () => {
    await supabase
      .from('games')
      .update({ status: 'results', question_start_time: null })
      .eq('id', game.id)

    broadcastGameState({
      status: 'results',
      current_question_index: game.current_question_index,
      question_start_time: null,
    })
    setGame(prev => ({ ...prev, status: 'results', question_start_time: null }))
  }, [game.id, game.current_question_index, broadcastGameState, supabase])

  // Shifts the question start time backwards so everyone's countdown drops —
  // players recompute their timers from question_start_time automatically.
  const shortenTimer = useCallback(async (seconds: number) => {
    if (game.status !== 'question' || !game.question_start_time) return

    const newStart = new Date(
      new Date(game.question_start_time).getTime() - seconds * 1000
    ).toISOString()

    await supabase
      .from('games')
      .update({ question_start_time: newStart })
      .eq('id', game.id)

    broadcastGameState({
      status: 'question',
      current_question_index: game.current_question_index,
      question_start_time: newStart,
    })
    setGame(prev => ({ ...prev, question_start_time: newStart }))
  }, [game.id, game.status, game.question_start_time, game.current_question_index, broadcastGameState, supabase])

  const startNextQuestion = useCallback(async (questionIndex = game.current_question_index) => {
    const timestamp = new Date().toISOString()
    const update = {
      status: 'question' as const,
      current_question_index: questionIndex,
      question_start_time: timestamp,
    }

    await supabase.from('games').update(update).eq('id', game.id)

    broadcastGameState(update)
    setGame(prev => ({ ...prev, ...update }))
    setAnswers([])
    setTimeLeft(questions[questionIndex]?.time_limit || 20)
  }, [game.id, game.current_question_index, questions, broadcastGameState, supabase])

  const nextQuestion = useCallback(async () => {
    const nextIndex = game.current_question_index + 1

    if (nextIndex >= questions.length) {
      // Game finished
      await supabase
        .from('games')
        .update({ status: 'finished' })
        .eq('id', game.id)
      broadcastGameState({ status: 'finished', current_question_index: game.current_question_index })
      setGame(prev => ({ ...prev, status: 'finished' }))
    } else if (shouldShowLeaderboardBreak(nextIndex)) {
      const update = {
        status: 'playing' as const,
        current_question_index: nextIndex,
        question_start_time: null,
      }

      await supabase.from('games').update(update).eq('id', game.id)

      broadcastGameState(update)
      setGame(prev => ({ ...prev, ...update }))
      setAnswers([])
    } else {
      await startNextQuestion(nextIndex)
    }

    await fetchPlayers()
  }, [fetchPlayers, game.current_question_index, game.id, questions.length, shouldShowLeaderboardBreak, startNextQuestion, broadcastGameState, supabase])

  useEffect(() => {
    if (game.status !== 'results') return

    const timeout = setTimeout(() => {
      void nextQuestion()
    }, 5000)

    return () => clearTimeout(timeout)
  }, [game.status, game.current_question_index, nextQuestion])

  useEffect(() => {
    if (game.status !== 'playing') return

    const timeout = setTimeout(() => {
      void startNextQuestion()
    }, 5000)

    return () => clearTimeout(timeout)
  }, [game.status, game.current_question_index, startNextQuestion])

  const endGame = async () => {
    await supabase.from('games').delete().eq('id', game.id)
    router.push('/dashboard')
  }

  // Get answer counts for current question
  const getAnswerCounts = () => {
    const counts: number[] = currentQuestion?.options.map(() => 0) || []
    currentGameAnswers.forEach(a => {
      if (a.question_id === currentQuestion?.id && counts[a.selected_option] !== undefined) {
        counts[a.selected_option]++
      }
    })
    return counts
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-card/50 backdrop-blur border-b border-border px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brand showText={false} logoClassName="h-9 w-auto" />
            <span className="font-bold text-lg">{game.quiz.title}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-5 w-5" />
              <span>
                {teamMode
                  ? `${players.length} players - ${teamStandings.length} teams`
                  : `${players.length} players`}
              </span>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={endGame}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        {game.status === 'waiting' && (
          <WaitingScreen
            pin={game.pin}
            players={players}
            teams={teamStandings}
            teamMode={teamMode}
            onStart={startGame}
            canStart={players.length > 0}
          />
        )}

        {game.status === 'question' && currentQuestion && (
          <QuestionScreen
            question={currentQuestion}
            questionNumber={game.current_question_index + 1}
            totalQuestions={questions.length}
            timeLeft={timeLeft}
            answeredCount={currentGameAnswers.length}
            totalPlayers={players.length}
            onTimeUp={showResults}
            onShortenTimer={() => shortenTimer(10)}
            onEndQuestion={showResults}
          />
        )}

        {game.status === 'results' && currentQuestion && (
          <ResultsScreen
            question={currentQuestion}
            answerCounts={getAnswerCounts()}
            onNext={nextQuestion}
            isLastQuestion={game.current_question_index >= questions.length - 1}
            nextStepLabel={shouldShowLeaderboardBreak(game.current_question_index + 1) ? 'Leaderboard' : 'Next Question'}
          />
        )}

        {game.status === 'playing' && (
          <LeaderboardBreakScreen
            players={players}
            teamMode={teamMode}
            currentQuestionNumber={game.current_question_index}
            totalQuestions={questions.length}
            onContinue={() => startNextQuestion()}
          />
        )}

        {game.status === 'finished' && (
          <FinalScreen players={players} teamMode={teamMode} onEnd={endGame} />
        )}
      </main>
    </div>
  )
}

function WaitingScreen({
  pin,
  players,
  teams,
  teamMode,
  onStart,
  canStart
}: {
  pin: string
  players: Player[]
  teams: TeamStanding[]
  teamMode: boolean
  onStart: () => void
  canStart: boolean
}) {
  // Show the real deployment address instead of a hardcoded domain
  const [siteHost, setSiteHost] = useState('')
  useEffect(() => {
    setSiteHost(window.location.host)
  }, [])

  return (
    <div className="w-full max-w-2xl text-center animate-slide-up">
      <Card className="bg-card/50 backdrop-blur animate-pulse-glow mb-8">
        <CardContent className="py-12">
          <p className="text-muted-foreground mb-2">{siteHost ? `Join at ${siteHost}` : 'Join with the game PIN'}</p>
          <h2 className="text-6xl md:text-8xl font-mono font-bold tracking-widest text-primary mb-4">
            {pin}
          </h2>
          <p className="text-muted-foreground">
            {teamMode ? 'Enter this PIN and your team code to join' : 'Enter this PIN to join'}
          </p>
        </CardContent>
      </Card>

      <div className="mb-8">
        <h3 className="text-xl font-semibold mb-4">
          {teamMode ? `Teams (${teams.length}) - Players (${players.length})` : `Players (${players.length})`}
        </h3>
        {teamMode && teams.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((team) => (
              <div key={team.code} className="rounded-xl border border-border bg-secondary/30 px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-lg font-black text-primary">{team.code}</span>
                  <span className="text-sm text-muted-foreground">{team.playerCount} players</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {team.players.map((player) => (
                    <span key={player.id} className="rounded-full bg-background/60 px-3 py-1 text-xs font-medium animate-pop-in">
                      {player.nickname}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {players.map((player) => (
              <div
                key={player.id}
                className="px-4 py-2 bg-secondary rounded-full text-sm font-medium animate-pop-in"
              >
                {player.nickname}
              </div>
            ))}
            {players.length === 0 && (
              <p className="text-muted-foreground">Waiting for players to join...</p>
            )}
            </div>
        )}
      </div>

      <Button 
        size="lg" 
        onClick={onStart} 
        disabled={!canStart}
        className="text-lg px-8"
      >
        <Play className="mr-2 h-5 w-5" />
        Start Game
      </Button>
    </div>
  )
}

function QuestionScreen({
  question,
  questionNumber,
  totalQuestions,
  timeLeft,
  answeredCount,
  totalPlayers,
  onTimeUp,
  onShortenTimer,
  onEndQuestion,
}: {
  question: Question
  questionNumber: number
  totalQuestions: number
  timeLeft: number | null
  answeredCount: number
  totalPlayers: number
  onTimeUp: () => void
  onShortenTimer: () => void
  onEndQuestion: () => void
}) {
  const options = question.options as QuestionOption[]

  useEffect(() => {
    if (timeLeft === 0) {
      onTimeUp()
    }
  }, [timeLeft, onTimeUp])

  // Solid Kahoot-style colors — vivid on the projector in both themes
  const optionColors = [
    'bg-red-500 border-red-600',
    'bg-blue-500 border-blue-600',
    'bg-yellow-500 border-yellow-600',
    'bg-green-500 border-green-600',
  ]

  const timePercent = timeLeft !== null && question.time_limit > 0
    ? Math.min(100, (timeLeft / question.time_limit) * 100)
    : 100
  const answeredPercent = totalPlayers > 0 ? (answeredCount / totalPlayers) * 100 : 0

  return (
    <div className="w-full max-w-4xl animate-slide-up" key={question.id}>
      {/* Timer and Progress */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-muted-foreground">
          Question {questionNumber} of {totalQuestions}
        </div>
        <div className={`text-4xl font-bold font-mono ${timeLeft !== null && timeLeft <= 5 ? 'text-primary animate-timer-pulse' : ''}`}>
          {timeLeft ?? '--'}
        </div>
        <div className="text-muted-foreground">
          {answeredCount}/{totalPlayers} answered
        </div>
      </div>

      {/* Time remaining bar */}
      <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-linear ${
            timeLeft !== null && timeLeft <= 5 ? 'bg-primary' : 'bg-primary/60'
          }`}
          style={{ width: `${timePercent}%` }}
        />
      </div>

      {/* Question */}
      <Card className="bg-card/50 mb-6">
        <CardContent className="py-8">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-balance">
            {question.question_text}
          </h2>
        </CardContent>
      </Card>

      {question.image_url && (
        <div className="mb-6 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={question.image_url}
            alt="Question illustration"
            className="max-h-72 rounded-xl border border-border object-contain shadow-lg animate-pop-in"
          />
        </div>
      )}

      {/* Options */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {options.map((option, index) => (
          <div
            key={index}
            className={`p-6 rounded-xl border-2 ${optionColors[index]} flex items-center gap-4 animate-pop-in stagger-${index + 1} text-white shadow-lg`}
          >
            <div className="w-10 h-10 shrink-0 rounded-lg bg-white/20 flex items-center justify-center">
              <AnswerShape index={index} className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold">{option.text}</span>
          </div>
        ))}
      </div>

      {/* Answered progress */}
      <div className="mx-auto max-w-md">
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-500"
            style={{ width: `${answeredPercent}%` }}
          />
        </div>
      </div>

      {/* Host timer controls */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onShortenTimer}
          disabled={timeLeft === null || timeLeft <= 0}
        >
          <FastForward className="mr-2 h-4 w-4" />
          -10s
        </Button>
        <Button variant="outline" size="sm" onClick={onEndQuestion}>
          <SkipForward className="mr-2 h-4 w-4" />
          End question now
        </Button>
      </div>
    </div>
  )
}

function ResultsScreen({
  question,
  answerCounts,
  onNext,
  isLastQuestion,
  nextStepLabel,
}: {
  question: Question
  answerCounts: number[]
  onNext: () => void
  isLastQuestion: boolean
  nextStepLabel: string
}) {
  const options = question.options as QuestionOption[]
  const totalAnswers = answerCounts.reduce((a, b) => a + b, 0)

  const optionColors = [
    { bg: 'bg-red-500', bar: 'bg-red-500/50' },
    { bg: 'bg-blue-500', bar: 'bg-blue-500/50' },
    { bg: 'bg-yellow-500', bar: 'bg-yellow-500/50' },
    { bg: 'bg-green-500', bar: 'bg-green-500/50' },
  ]

  return (
    <div className="w-full max-w-4xl animate-slide-up">
      <Card className="bg-card/50 mb-8">
        <CardContent className="py-6">
          <h2 className="text-xl md:text-2xl font-bold text-center text-balance">
            {question.question_text}
          </h2>
        </CardContent>
      </Card>

      <div className="space-y-4 mb-8">
        {options.map((option, index) => {
          const percentage = totalAnswers > 0 ? (answerCounts[index] / totalAnswers) * 100 : 0
          return (
            <div key={index} className="relative">
              <div
                className={`absolute inset-0 rounded-xl ${optionColors[index].bar} transition-[width] duration-700 ease-out`}
                style={{ width: `${percentage}%` }}
              />
              <div className={`relative p-4 rounded-xl border-2 flex items-center justify-between ${
                option.isCorrect ? 'border-green-500 bg-green-500/10' : 'border-border'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg ${optionColors[index].bg} flex items-center justify-center text-white`}>
                    <AnswerShape index={index} className="h-4 w-4" />
                  </div>
                  <span className="font-medium">{option.text}</span>
                  {option.isCorrect && (
                    <span className="text-green-400 text-sm">Correct</span>
                  )}
                </div>
                <div className="font-bold">{answerCounts[index]}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-center">
        <p className="mb-4 text-sm text-muted-foreground">Moving on automatically in 5 seconds...</p>
        <Button size="lg" onClick={onNext} className="text-lg px-8">
          {isLastQuestion ? (
            <>
              <Trophy className="mr-2 h-5 w-5" />
              See Final Results
            </>
          ) : (
            <>
              {nextStepLabel}
              <ChevronRight className="ml-2 h-5 w-5" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function LeaderboardBreakScreen({
  players,
  teamMode,
  currentQuestionNumber,
  totalQuestions,
  onContinue,
}: {
  players: Player[]
  teamMode: boolean
  currentQuestionNumber: number
  totalQuestions: number
  onContinue: () => void
}) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)
  const topFive = sortedPlayers.slice(0, 5)
  const teamStandings = getTeamStandings(players)
  const topFiveTeams = teamStandings.slice(0, 5)
  const checkpoint = Math.min(currentQuestionNumber, totalQuestions)
  // Reveal rows bottom-up so the leader lands last, Kahoot-style
  const revealDelay = (index: number, total: number) => ({
    animationDelay: `${(total - 1 - index) * 0.35 + 0.2}s`,
  })

  return (
    <div className="w-full max-w-5xl animate-slide-up">
      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
          <Trophy className="h-12 w-12 text-amber-600 dark:text-amber-300" />
        </div>
        <h2 className="text-5xl font-black mb-2">Leaderboard Break</h2>
        <p className="text-lg text-muted-foreground">
          Standings after question {checkpoint} of {totalQuestions}
        </p>
      </div>

      <Card className="mb-8 border-border/60 bg-gradient-to-b from-card to-card/70 shadow-[0_0_80px_rgba(239,0,0,0.14)]">
        <CardContent className="py-8">
          {teamMode && (
          <div className="mx-auto mb-8 max-w-3xl space-y-3">
            <h3 className="text-left text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Team standings
            </h3>
            {topFiveTeams.map((team, index) => (
              <div
                key={team.code}
                style={revealDelay(index, topFiveTeams.length)}
                className={`animate-leaderboard-in flex items-center justify-between rounded-2xl border px-5 py-4 ${
                  index === 0
                    ? 'border-amber-300/50 bg-amber-300/15'
                    : index === 1
                      ? 'border-slate-300/40 bg-slate-200/10'
                      : index === 2
                        ? 'border-orange-400/40 bg-orange-500/10'
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
                  <div>
                    <div className="text-xl font-bold text-foreground">{team.code}</div>
                    <div className="text-sm text-muted-foreground">
                      {team.playerCount} players - {team.totalScore.toLocaleString()} total
                    </div>
                  </div>
                </div>
                <span className="text-xl font-bold text-foreground">{team.averageScore.toLocaleString()} avg pts</span>
              </div>
            ))}
          </div>
          )}

          <div className="mx-auto max-w-3xl space-y-3">
            <h3 className="text-left text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {teamMode ? 'Individual top 5' : 'Top 5 players'}
            </h3>
            {topFive.map((player, index) => (
              <div
                key={player.id}
                style={revealDelay(index, topFive.length)}
                className={`animate-leaderboard-in flex items-center justify-between rounded-2xl border px-5 py-4 ${
                  index === 0
                    ? 'border-amber-300/50 bg-amber-300/15'
                    : index === 1
                      ? 'border-slate-300/40 bg-slate-200/10'
                      : index === 2
                        ? 'border-orange-400/40 bg-orange-500/10'
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
                  <div>
                    <div className="text-xl font-bold text-foreground">{player.nickname}</div>
                    {teamMode && <div className="text-sm text-muted-foreground">{getPlayerTeamCode(player)}</div>}
                  </div>
                </div>
                <span className="text-xl font-bold text-foreground">{player.score.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="text-center">
        <p className="mb-4 text-sm text-muted-foreground">Next question starts automatically in 5 seconds...</p>
        <Button size="lg" onClick={onContinue} className="text-lg px-8">
          Continue Quiz
          <ChevronRight className="ml-2 h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}

function FinalScreen({
  players,
  teamMode,
  onEnd
}: {
  players: Player[]
  teamMode: boolean
  onEnd: () => void
}) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)
  const topFive = sortedPlayers.slice(0, 5)
  const teamStandings = getTeamStandings(players)
  const topFiveTeams = teamStandings.slice(0, 5)
  const podiumEntries = teamMode
    ? teamStandings.slice(0, 3).map((team) => ({
        id: team.code,
        name: team.code,
        detail: `${team.averageScore.toLocaleString()} avg pts`,
      }))
    : sortedPlayers.slice(0, 3).map((player) => ({
        id: player.id,
        name: player.nickname,
        detail: `${player.score.toLocaleString()} pts`,
      }))
  const podiumOrder = [1, 0, 2]
  const podiumHeightsByRank = ['h-72', 'h-52', 'h-40']
  const podiumStylesByRank = [
    'from-amber-300 via-yellow-400 to-orange-500 text-slate-950',
    'from-slate-200 to-slate-500 text-slate-950',
    'from-orange-300 to-amber-700 text-slate-950',
  ]

  return (
    <div className="w-full max-w-5xl text-center animate-slide-up">
      <div className="mb-8">
        <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
          <Trophy className="h-14 w-14 text-amber-600 dark:text-amber-300" />
        </div>
        <h2 className="text-6xl font-black">Final Results</h2>
      </div>

      <Card className="mb-8 border-border/60 bg-gradient-to-b from-card to-card/70 shadow-[0_0_100px_rgba(239,0,0,0.16)]">
        <CardContent className="py-10">
          <div className="mb-6">
            <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-6 py-2 text-lg font-semibold text-amber-700 dark:text-amber-200">
              {teamMode
                ? `Winning Team: ${teamStandings[0]?.code ?? 'TBD'}`
                : `Winner: ${sortedPlayers[0]?.nickname ?? 'TBD'}`}
            </span>
          </div>

          <div className="mb-12 flex justify-center items-end gap-5">
            {podiumOrder.map((position) => {
              const entry = podiumEntries[position]
              if (!entry) return null
              return (
                <div key={entry.id} className="flex w-40 flex-col items-center">
                  <div className="mb-4">
                    <div className={`text-3xl font-black ${position === 0 ? 'text-amber-600 dark:text-amber-300' : 'text-foreground'}`}>
                      {position === 0 ? 'WINNER' : `#${position + 1}`}
                    </div>
                    <div className="mt-1 text-3xl font-black text-foreground">{entry.name}</div>
                    <div className="text-lg text-muted-foreground">{entry.detail}</div>
                  </div>
                  <div className={`flex w-full ${podiumHeightsByRank[position]} items-end justify-center rounded-t-[2rem] bg-gradient-to-b ${podiumStylesByRank[position]} pb-5 shadow-2xl animate-podium-rise stagger-${position + 1}`}>
                    <span className="text-6xl font-black">{position + 1}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {teamMode && (
          <div className="mx-auto max-w-3xl">
            <h3 className="mb-4 text-2xl font-black text-foreground">Team Standings</h3>
            <div className="space-y-3">
              {topFiveTeams.map((team, index) => (
                <div
                  key={team.code}
                  className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
                    index === 0
                      ? 'border-amber-300/50 bg-amber-300/15'
                      : index === 1
                        ? 'border-slate-300/40 bg-slate-200/10'
                        : index === 2
                          ? 'border-orange-400/40 bg-orange-500/10'
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
                      <div className="text-xl font-bold text-foreground">{team.code}</div>
                      <div className="text-sm text-muted-foreground">
                        {team.playerCount} players - {team.totalScore.toLocaleString()} total
                      </div>
                    </div>
                  </div>
                  <span className="text-xl font-bold text-foreground">{team.averageScore.toLocaleString()} avg pts</span>
                </div>
              ))}
            </div>
          </div>
          )}

          <div className="mx-auto mt-8 max-w-3xl">
            <h3 className="mb-4 text-left text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {teamMode ? 'Individual top 5' : 'Top 5 players'}
            </h3>
            <div className="space-y-3">
              {topFive.map((player, index) => (
                <div key={player.id} className="flex items-center justify-between rounded-2xl border border-border bg-secondary/30 px-5 py-4">
                  <div className="flex items-center gap-4">
                    <span className="w-12 text-2xl font-black text-primary">#{index + 1}</span>
                    <div className="text-left">
                      <div className="text-xl font-bold text-foreground">{player.nickname}</div>
                      {teamMode && <div className="text-sm text-muted-foreground">{getPlayerTeamCode(player)}</div>}
                    </div>
                  </div>
                  <span className="text-xl font-bold text-foreground">{player.score.toLocaleString()} pts</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Button size="lg" onClick={onEnd} className="text-lg px-8">
        End Game
      </Button>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Zap, Users, Play, ChevronRight, Trophy, X } from 'lucide-react'
import type { Game, Player, Question, QuestionOption, Answer } from '@/lib/types'
import { Brand } from '@/components/brand'

interface HostGameClientProps {
  initialGame: Game & { 
    quiz: { 
      title: string
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
  const quarterSize = Math.max(1, Math.ceil(questions.length / 4))
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
    (nextIndex: number) => nextIndex > 0 && nextIndex < questions.length && nextIndex % quarterSize === 0,
    [questions.length, quarterSize]
  )

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
    await supabase
      .from('games')
      .update({ 
        status: 'question',
        current_question_index: 0,
        question_start_time: new Date().toISOString()
      })
      .eq('id', game.id)

    setGame(prev => ({ 
      ...prev, 
      status: 'question', 
      current_question_index: 0,
      question_start_time: new Date().toISOString()
    }))
    setAnswers([])
    setTimeLeft(currentQuestion?.time_limit || 20)
  }

  const showResults = useCallback(async () => {
    await supabase
      .from('games')
      .update({ status: 'results', question_start_time: null })
      .eq('id', game.id)

    setGame(prev => ({ ...prev, status: 'results', question_start_time: null }))
  }, [game.id, supabase])

  const startNextQuestion = useCallback(async (questionIndex = game.current_question_index) => {
    const timestamp = new Date().toISOString()

    await supabase
      .from('games')
      .update({
        status: 'question',
        current_question_index: questionIndex,
        question_start_time: timestamp
      })
      .eq('id', game.id)

    setGame(prev => ({
      ...prev,
      status: 'question',
      current_question_index: questionIndex,
      question_start_time: timestamp
    }))
    setAnswers([])
    setTimeLeft(questions[questionIndex]?.time_limit || 20)
  }, [game.id, game.current_question_index, questions, supabase])

  const nextQuestion = useCallback(async () => {
    const nextIndex = game.current_question_index + 1

    if (nextIndex >= questions.length) {
      // Game finished
      await supabase
        .from('games')
        .update({ status: 'finished' })
        .eq('id', game.id)
      setGame(prev => ({ ...prev, status: 'finished' }))
    } else if (shouldShowLeaderboardBreak(nextIndex)) {
      await supabase
        .from('games')
        .update({
          status: 'playing',
          current_question_index: nextIndex,
          question_start_time: null
        })
        .eq('id', game.id)

      setGame(prev => ({
        ...prev,
        status: 'playing',
        current_question_index: nextIndex,
        question_start_time: null
      }))
      setAnswers([])
    } else {
      await startNextQuestion(nextIndex)
    }

    await fetchPlayers()
  }, [fetchPlayers, game.current_question_index, game.id, questions.length, shouldShowLeaderboardBreak, startNextQuestion, supabase])

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
              <span>{players.length} players</span>
            </div>
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
            currentQuestionNumber={game.current_question_index}
            totalQuestions={questions.length}
            onContinue={() => startNextQuestion()}
          />
        )}

        {game.status === 'finished' && (
          <FinalScreen players={players} onEnd={endGame} />
        )}
      </main>
    </div>
  )
}

function WaitingScreen({ 
  pin, 
  players, 
  onStart,
  canStart 
}: { 
  pin: string
  players: Player[]
  onStart: () => void
  canStart: boolean
}) {
  return (
    <div className="w-full max-w-2xl text-center">
      <Card className="bg-card/50 backdrop-blur animate-pulse-glow mb-8">
        <CardContent className="py-12">
          <p className="text-muted-foreground mb-2">Join at quizblitz.app</p>
          <h2 className="text-6xl md:text-8xl font-mono font-bold tracking-widest text-primary mb-4">
            {pin}
          </h2>
          <p className="text-muted-foreground">Enter this PIN to join the game</p>
        </CardContent>
      </Card>

      <div className="mb-8">
        <h3 className="text-xl font-semibold mb-4">Players ({players.length})</h3>
        <div className="flex flex-wrap justify-center gap-2">
          {players.map((player) => (
            <div
              key={player.id}
              className="px-4 py-2 bg-secondary rounded-full text-sm font-medium"
            >
              {player.nickname}
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-muted-foreground">Waiting for players to join...</p>
          )}
        </div>
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
}: {
  question: Question
  questionNumber: number
  totalQuestions: number
  timeLeft: number | null
  answeredCount: number
  totalPlayers: number
  onTimeUp: () => void
}) {
  const options = question.options as QuestionOption[]

  useEffect(() => {
    if (timeLeft === 0) {
      onTimeUp()
    }
  }, [timeLeft, onTimeUp])

  const optionColors = [
    'bg-red-500/20 border-red-500/50',
    'bg-blue-500/20 border-blue-500/50',
    'bg-yellow-500/20 border-yellow-500/50',
    'bg-green-500/20 border-green-500/50',
  ]

  return (
    <div className="w-full max-w-4xl">
      {/* Timer and Progress */}
      <div className="flex items-center justify-between mb-6">
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

      {/* Question */}
      <Card className="bg-card/50 mb-8">
        <CardContent className="py-8">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-balance">
            {question.question_text}
          </h2>
        </CardContent>
      </Card>

      {/* Options */}
      <div className="grid grid-cols-2 gap-4">
        {options.map((option, index) => (
          <div
            key={index}
            className={`p-6 rounded-xl border-2 ${optionColors[index]} flex items-center gap-4`}
          >
            <div className="w-10 h-10 rounded-lg bg-background/50 flex items-center justify-center font-bold">
              {String.fromCharCode(65 + index)}
            </div>
            <span className="text-lg font-medium">{option.text}</span>
          </div>
        ))}
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
    <div className="w-full max-w-4xl">
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
                className={`absolute inset-0 rounded-xl ${optionColors[index].bar}`}
                style={{ width: `${percentage}%` }}
              />
              <div className={`relative p-4 rounded-xl border-2 flex items-center justify-between ${
                option.isCorrect ? 'border-green-500 bg-green-500/10' : 'border-border'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg ${optionColors[index].bg} flex items-center justify-center font-bold text-white`}>
                    {String.fromCharCode(65 + index)}
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
  currentQuestionNumber,
  totalQuestions,
  onContinue,
}: {
  players: Player[]
  currentQuestionNumber: number
  totalQuestions: number
  onContinue: () => void
}) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)
  const topPlayers = sortedPlayers.slice(0, 8)
  const checkpoint = Math.min(currentQuestionNumber, totalQuestions)

  return (
    <div className="w-full max-w-3xl">
      <div className="text-center mb-8">
        <Trophy className="h-14 w-14 text-quiz-gold mx-auto mb-4" />
        <h2 className="text-4xl font-bold mb-2">Leaderboard Break</h2>
        <p className="text-muted-foreground">
          Standings after question {checkpoint} of {totalQuestions}
        </p>
      </div>

      <Card className="bg-card/50 mb-8">
        <CardContent className="py-4">
          <div className="space-y-3">
            {topPlayers.map((player, index) => (
              <div
                key={player.id}
                className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 text-lg font-bold text-primary">#{index + 1}</span>
                  <span className="font-semibold">{player.nickname}</span>
                </div>
                <span className="text-muted-foreground">{player.score.toLocaleString()} pts</span>
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
  onEnd 
}: { 
  players: Player[]
  onEnd: () => void 
}) {
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)
  const topThree = sortedPlayers.slice(0, 3)
  const rest = sortedPlayers.slice(3)

  const medals = ['text-quiz-gold', 'text-quiz-silver', 'text-quiz-bronze']

  return (
    <div className="w-full max-w-2xl text-center">
      <div className="mb-8">
        <Trophy className="h-16 w-16 text-quiz-gold mx-auto mb-4" />
        <h2 className="text-4xl font-bold">Final Results</h2>
      </div>

      {/* Podium */}
      <div className="flex justify-center items-end gap-4 mb-8">
        {[1, 0, 2].map((position) => {
          const player = topThree[position]
          if (!player) return null
          const heights = ['h-32', 'h-40', 'h-24']
          return (
            <div key={position} className="flex flex-col items-center">
              <div className="text-4xl mb-2">{position === 0 ? '👑' : ''}</div>
              <div className={`font-bold text-lg ${medals[position]}`}>
                {player.nickname}
              </div>
              <div className="text-muted-foreground text-sm mb-2">
                {player.score.toLocaleString()} pts
              </div>
              <div className={`w-24 ${heights[position]} bg-primary/20 rounded-t-lg flex items-end justify-center pb-2`}>
                <span className={`text-2xl font-bold ${medals[position]}`}>
                  {position + 1}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Rest of players */}
      {rest.length > 0 && (
        <Card className="bg-card/50 mb-8">
          <CardContent className="py-4">
            {rest.map((player, index) => (
              <div
                key={player.id}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground w-6">{index + 4}</span>
                  <span className="font-medium">{player.nickname}</span>
                </div>
                <span className="text-muted-foreground">{player.score.toLocaleString()} pts</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button size="lg" onClick={onEnd} className="text-lg px-8">
        End Game
      </Button>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Play, Edit2, Trash2, MoreVertical, LogOut, HelpCircle, User as UserIcon, Users } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import type { Quiz, Profile, GameMode } from '@/lib/types'
import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'

interface DashboardClientProps {
  user: User
  quizzes: (Quiz & { questions: { count: number }[] })[]
  profile: Profile | null
}

export function DashboardClient({ user, quizzes, profile }: DashboardClientProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [modePickerQuizId, setModePickerQuizId] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const handleDeleteQuiz = async (quizId: string) => {
    if (!confirm('Are you sure you want to delete this quiz?')) return

    setLoading(quizId)
    await supabase.from('quizzes').delete().eq('id', quizId)
    router.refresh()
    setLoading(null)
  }

  const handleStartGame = async (quizId: string, mode: GameMode) => {
    setModePickerQuizId(null)
    setLoading(quizId)
    setErrorMessage(null)

    const pin = Math.random().toString(36).substring(2, 8).toUpperCase()

    let { data: game, error } = await supabase
      .from('games')
      .insert({
        quiz_id: quizId,
        host_id: user.id,
        pin,
        status: 'waiting',
        mode,
      })
      .select()
      .single()

    // Fall back for databases that have not run 009_add_game_mode.sql yet
    if (error?.code === 'PGRST204' && error.message.includes('mode')) {
      ;({ data: game, error } = await supabase
        .from('games')
        .insert({
          quiz_id: quizId,
          host_id: user.id,
          pin,
          status: 'waiting',
        })
        .select()
        .single())
    }

    if (error || !game) {
      console.error('Error creating game:', error)
      setErrorMessage(error?.message ?? 'Unable to create game right now.')
      setLoading(null)
      return
    }

    router.push(`/host/${game.id}`)
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Brand />
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {profile?.display_name || user.email}
            </span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Quizzes</h1>
            <p className="text-muted-foreground">Create and manage your quiz games</p>
          </div>
          <Link href="/dashboard/create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Quiz
            </Button>
          </Link>
        </div>

        {errorMessage && (
          <div className="mb-6 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {quizzes.length === 0 ? (
          <Card className="bg-card/50 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <HelpCircle className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No quizzes yet</h3>
              <p className="text-muted-foreground mb-4">Create your first quiz to get started</p>
              <Link href="/dashboard/create">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Quiz
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((quiz) => (
              <Card key={quiz.id} className="bg-card/50 hover:bg-card/70 transition-colors flex h-full flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg leading-snug break-words line-clamp-2">
                        {quiz.title}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {quiz.questions[0]?.count || 0} questions
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0 -mr-2 -mt-1">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/dashboard/edit/${quiz.id}`}>
                            <Edit2 className="mr-2 h-4 w-4" />
                            Edit
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteQuiz(quiz.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  {quiz.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 break-words mb-4">
                      {quiz.description}
                    </p>
                  )}
                  <Button
                    className="w-full mt-auto"
                    onClick={() => setModePickerQuizId(quiz.id)}
                    disabled={loading === quiz.id || (quiz.questions[0]?.count || 0) === 0}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {loading === quiz.id ? 'Starting...' : 'Start Game'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={modePickerQuizId !== null} onOpenChange={(open) => !open && setModePickerQuizId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choose game mode</DialogTitle>
            <DialogDescription>How should players compete in this game?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <button
              onClick={() => modePickerQuizId && handleStartGame(modePickerQuizId, 'classic')}
              className="flex items-center gap-4 rounded-xl border-2 border-border bg-secondary/30 p-4 text-left transition-colors hover:border-primary hover:bg-primary/10"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <UserIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="font-bold">Classic</div>
                <div className="text-sm text-muted-foreground">
                  Everyone plays for themselves. Individual leaderboard only.
                </div>
              </div>
            </button>
            <button
              onClick={() => modePickerQuizId && handleStartGame(modePickerQuizId, 'team')}
              className="flex items-center gap-4 rounded-xl border-2 border-border bg-secondary/30 p-4 text-left transition-colors hover:border-primary hover:bg-primary/10"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="font-bold">Team Mode</div>
                <div className="text-sm text-muted-foreground">
                  Players join with a team code. Team and individual leaderboards.
                </div>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

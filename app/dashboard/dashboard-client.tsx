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
import { Plus, Play, Edit2, Trash2, MoreVertical, LogOut, HelpCircle } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import type { Quiz, Profile } from '@/lib/types'
import { Brand } from '@/components/brand'

interface DashboardClientProps {
  user: User
  quizzes: (Quiz & { questions: { count: number }[] })[]
  profile: Profile | null
}

export function DashboardClient({ user, quizzes, profile }: DashboardClientProps) {
  const [loading, setLoading] = useState<string | null>(null)
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

  const handleStartGame = async (quizId: string) => {
    setLoading(quizId)
    
    // Generate a 6-character PIN
    const pin = Math.random().toString(36).substring(2, 8).toUpperCase()
    
    const { data: game, error } = await supabase
      .from('games')
      .insert({
        quiz_id: quizId,
        host_id: user.id,
        pin,
        status: 'waiting',
      })
      .select()
      .single()
    
    if (error) {
      console.error('Error creating game:', error)
      setLoading(null)
      return
    }
    
    router.push(`/host/${game.id}`)
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Brand />
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {profile?.display_name || user.email}
            </span>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
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
              <Card key={quiz.id} className="bg-card/50 hover:bg-card/70 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{quiz.title}</CardTitle>
                      <CardDescription className="truncate">
                        {quiz.questions[0]?.count || 0} questions
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0">
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
                <CardContent>
                  {quiz.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                      {quiz.description}
                    </p>
                  )}
                  <Button 
                    className="w-full" 
                    onClick={() => handleStartGame(quiz.id)}
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
    </div>
  )
}

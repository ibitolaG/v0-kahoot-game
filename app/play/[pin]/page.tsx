'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Zap, ArrowLeft, Loader2 } from 'lucide-react'

export default function JoinGamePage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = use(params)
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [gameExists, setGameExists] = useState(false)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  // Check if game exists
  useEffect(() => {
    const checkGame = async () => {
      const { data: game } = await supabase
        .from('games')
        .select('id, status')
        .eq('pin', pin.toUpperCase())
        .single()

      if (!game) {
        setError('Game not found. Please check the PIN and try again.')
        setGameExists(false)
      } else if (game.status !== 'waiting') {
        setError('This game has already started.')
        setGameExists(false)
      } else {
        setGameExists(true)
      }
      setLoading(false)
    }

    checkGame()
  }, [pin, supabase])

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickname.trim()) {
      setError('Please enter a nickname')
      return
    }

    setJoining(true)
    setError(null)

    // Find the game
    const { data: game } = await supabase
      .from('games')
      .select('id, status')
      .eq('pin', pin.toUpperCase())
      .single()

    if (!game) {
      setError('Game not found')
      setJoining(false)
      return
    }

    if (game.status !== 'waiting') {
      setError('This game has already started')
      setJoining(false)
      return
    }

    // Create player
    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({
        game_id: game.id,
        nickname: nickname.trim(),
      })
      .select()
      .single()

    if (playerError) {
      setError('Failed to join game. Please try again.')
      setJoining(false)
      return
    }

    // Store player ID and navigate to game
    setPlayerId(player.id)
    router.push(`/play/${pin.toUpperCase()}/game?player=${player.id}`)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="flex items-center gap-2 mb-8">
        <Zap className="h-8 w-8 text-primary" />
        <span className="text-2xl font-bold">QuizBlitz</span>
      </Link>

      <Card className="w-full max-w-md bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <div className="text-sm text-muted-foreground mb-1">Joining game</div>
            <div className="text-3xl font-mono font-bold tracking-widest text-primary">
              {pin.toUpperCase()}
            </div>
          </div>

          {!gameExists ? (
            <div className="text-center">
              <p className="text-destructive mb-4">{error}</p>
              <Link href="/">
                <Button variant="outline">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4">
              <Input
                type="text"
                placeholder="Enter your nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="text-center text-xl h-14 bg-secondary"
                maxLength={20}
                autoFocus
              />

              {error && (
                <p className="text-destructive text-sm text-center">{error}</p>
              )}

              <Button type="submit" className="w-full h-12 text-lg" disabled={joining}>
                {joining ? 'Joining...' : 'Join Game'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

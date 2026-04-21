'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Brand } from '@/components/brand'

export default function JoinGamePage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = use(params)
  const normalizedPin = pin.toUpperCase()
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [gameExists, setGameExists] = useState(false)
  const router = useRouter()
  const storageKey = `quizblitz:${normalizedPin}:reconnect-token`
  const nicknameStorageKey = `quizblitz:${normalizedPin}:nickname`

  // Check if game exists
  useEffect(() => {
    const checkGame = async () => {
      const reconnectToken = localStorage.getItem(storageKey)
      const params = new URLSearchParams({ pin: normalizedPin })
      if (reconnectToken) {
        params.set('reconnectToken', reconnectToken)
      }

      const response = await fetch(`/api/play/check?${params.toString()}`)
      const data = await response.json().catch(() => null)

      if (response.ok) {
        setError(null)
        setGameExists(true)
        if (data?.rejoinAvailable) {
          const savedNickname = localStorage.getItem(nicknameStorageKey)
          if (savedNickname) {
            setNickname(savedNickname)
          }
        }
      } else {
        setGameExists(false)
        setError(data?.error || 'Game not found. Please check the PIN and try again.')
      }
      setLoading(false)
    }

    checkGame()
  }, [normalizedPin, storageKey, nicknameStorageKey])

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    const reconnectToken = localStorage.getItem(storageKey)
    const savedNickname = localStorage.getItem(nicknameStorageKey)
    const effectiveNickname = nickname.trim() || savedNickname || ''

    if (!effectiveNickname) {
      setError('Please enter a nickname')
      return
    }

    setJoining(true)
    setError(null)

    const response = await fetch('/api/play/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: normalizedPin,
        nickname: effectiveNickname,
        reconnectToken,
      }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.playerId || !data?.reconnectToken) {
      setError(data?.error || 'Failed to join game. Please try again.')
      setJoining(false)
      return
    }

    localStorage.setItem(storageKey, data.reconnectToken)
    localStorage.setItem(nicknameStorageKey, effectiveNickname)
    router.push(`/play/${normalizedPin}/game?player=${data.playerId}`)
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
        <Brand />
      </Link>

      <Card className="w-full max-w-md bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <div className="text-sm text-muted-foreground mb-1">Joining game</div>
            <div className="text-3xl font-mono font-bold tracking-widest text-primary">
              {normalizedPin}
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

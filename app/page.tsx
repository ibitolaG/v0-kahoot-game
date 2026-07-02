'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Users, Trophy, Play, Zap } from 'lucide-react'
import { Brand } from '@/components/brand'

export default function HomePage() {
  const [pin, setPin] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const router = useRouter()

  const handleJoinGame = (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.trim()) {
      setIsJoining(true)
      router.push(`/play/${pin.trim().toUpperCase()}`)
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-12 animate-slide-up">
          <Brand className="justify-center mb-4" logoClassName="h-14 w-14" textClassName="text-left" />
          <p className="text-xl text-muted-foreground max-w-md mx-auto text-balance">
            Create and play real-time multiplayer quiz games with friends
          </p>
        </div>

        {/* Join Game Card */}
        <Card className="w-full max-w-md bg-card/50 backdrop-blur border-border/50 animate-pulse-glow animate-slide-up stagger-2">
          <CardContent className="p-6">
            <form onSubmit={handleJoinGame} className="space-y-4">
              <div className="text-center mb-4">
                <h2 className="text-2xl font-bold">Join a Game</h2>
                <p className="text-muted-foreground">Enter the game PIN to play</p>
              </div>
              <Input
                type="text"
                placeholder="Enter Game PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.toUpperCase())}
                className="text-center text-2xl font-mono tracking-widest h-14 bg-secondary border-border focus-visible:ring-primary/60"
                maxLength={6}
                aria-label="Game PIN"
                autoComplete="off"
              />
              <Button
                type="submit"
                className="w-full h-12 text-lg font-semibold transition-transform active:scale-[0.98]"
                disabled={!pin.trim() || isJoining}
              >
                <Play className="mr-2 h-5 w-5" />
                {isJoining ? 'Joining...' : 'Join Game'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* Features Section */}
      <section className="px-4 py-16 bg-secondary/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Users className="h-8 w-8" />}
              title="Create & Host"
              description="Build custom quizzes with multiple choice and true/false questions"
            />
            <FeatureCard
              icon={<Zap className="h-8 w-8" />}
              title="Real-time Play"
              description="Players join with a PIN and compete in real-time"
            />
            <FeatureCard
              icon={<Trophy className="h-8 w-8" />}
              title="Live Scoreboard"
              description="Watch scores update instantly as players answer"
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-6 text-center text-muted-foreground text-sm">
        <p>Built with Next.js and Supabase</p>
      </footer>
    </main>
  )
}

function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode
  title: string
  description: string 
}) {
  return (
    <div className="text-center p-6 rounded-2xl border border-border/50 bg-card/40 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_8px_30px_oklch(0.55_0.25_25_/_0.15)]">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}

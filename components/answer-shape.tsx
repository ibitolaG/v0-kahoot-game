import { Triangle, Diamond, Circle, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

// Kahoot-style shapes so answers are recognizable by shape as well as color —
// helps on small screens and for color-blind players.
const SHAPES = [Triangle, Diamond, Circle, Square]

export function AnswerShape({ index, className }: { index: number; className?: string }) {
  const Icon = SHAPES[index % SHAPES.length]
  return <Icon className={cn('h-5 w-5', className)} fill="currentColor" aria-hidden />
}

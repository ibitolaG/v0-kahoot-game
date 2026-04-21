import type { QuestionOption } from '@/lib/types'

export const DEFAULT_MAX_PLAYERS = 50

export function calculatePoints(
  options: QuestionOption[],
  selectedOption: number,
  timeLimit: number,
  timeTakenSeconds: number,
  basePoints: number
) {
  const isCorrect = options[selectedOption]?.isCorrect || false
  const cappedTimeTaken = Math.max(0, Math.min(timeTakenSeconds, timeLimit))
  const timeBonus = Math.max(0, timeLimit - cappedTimeTaken)
  const pointsEarned = isCorrect
    ? Math.floor(basePoints * (0.5 + (timeBonus / timeLimit) * 0.5))
    : 0

  return {
    isCorrect,
    pointsEarned,
  }
}

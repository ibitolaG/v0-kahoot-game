import type { Game, Player, QuestionOption } from '@/lib/types'

// Games created before the mode column existed behave like team games.
export function isTeamMode(game: Pick<Game, 'mode'> | null | undefined) {
  return (game?.mode ?? 'team') !== 'classic'
}

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

export interface TeamStanding {
  code: string
  totalScore: number
  averageScore: number
  playerCount: number
  players: Player[]
}

export function normalizeTeamCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 20)
}

export function getPlayerTeamCode(player: Pick<Player, 'team_code'>) {
  return normalizeTeamCode(player.team_code || 'GENERAL') || 'GENERAL'
}

export function getTeamStandings(players: Player[]) {
  const teams = new Map<string, Player[]>()

  players.forEach((player) => {
    const code = getPlayerTeamCode(player)
    const teamPlayers = teams.get(code) ?? []
    teamPlayers.push(player)
    teams.set(code, teamPlayers)
  })

  return Array.from(teams.entries())
    .map(([code, teamPlayers]): TeamStanding => {
      const totalScore = teamPlayers.reduce((sum, player) => sum + player.score, 0)
      return {
        code,
        totalScore,
        averageScore: teamPlayers.length ? Math.round(totalScore / teamPlayers.length) : 0,
        playerCount: teamPlayers.length,
        players: [...teamPlayers].sort((a, b) => b.score - a.score),
      }
    })
    .sort((a, b) => b.averageScore - a.averageScore || b.totalScore - a.totalScore || a.code.localeCompare(b.code))
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function findExistingPlayer(supabase: ReturnType<typeof createAdminClient>, gameId: string, reconnectToken: string) {
  let result = await supabase
    .from('players')
    .select('id, nickname, team_code')
    .eq('game_id', gameId)
    .eq('reconnect_token', reconnectToken)
    .maybeSingle()

  const errorMessage = result.error?.message ?? ''
  const missingColumn = result.error?.code === 'PGRST204'
  const missingReconnectColumn = missingColumn && errorMessage.includes('reconnect_token')
  const missingTeamColumn = missingColumn && errorMessage.includes('team_code')

  if (missingReconnectColumn) {
    return { data: null, error: null }
  }

  if (missingTeamColumn) {
    result = await supabase
      .from('players')
      .select('id, nickname')
      .eq('game_id', gameId)
      .eq('reconnect_token', reconnectToken)
      .maybeSingle()
  }

  return result
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const pin = url.searchParams.get('pin')?.trim().toUpperCase()
  const reconnectToken = url.searchParams.get('reconnectToken')?.trim()

  if (!pin) {
    return NextResponse.json({ gameExists: false, error: 'PIN is required.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  let { data: game, error } = await supabase
    .from('games')
    .select('id, status, mode')
    .eq('pin', pin)
    .maybeSingle()

  // Fall back for databases that have not run 009_add_game_mode.sql yet
  if (error && error.message.includes('mode')) {
    ;({ data: game, error } = await supabase
      .from('games')
      .select('id, status')
      .eq('pin', pin)
      .maybeSingle())
  }

  if (error || !game) {
    return NextResponse.json({ gameExists: false, error: 'Game not found.' }, { status: 404 })
  }

  const mode = ('mode' in game && game.mode === 'classic') ? 'classic' : 'team'

  if (reconnectToken) {
    const { data: existingPlayer } = await findExistingPlayer(supabase, game.id, reconnectToken)

    if (existingPlayer && game.status !== 'finished') {
      return NextResponse.json({
        gameExists: true,
        rejoinAvailable: true,
        mode,
        nickname: existingPlayer.nickname,
        teamCode: existingPlayer.team_code ?? null,
      })
    }
  }

  if (game.status !== 'waiting') {
    return NextResponse.json({ gameExists: false, error: 'This game has already started.' }, { status: 409 })
  }

  return NextResponse.json({
    gameExists: true,
    rejoinAvailable: false,
    mode,
  })
}

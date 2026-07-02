import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTeamCode } from '@/lib/gameplay'

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
    return { data: null, error: null, supportsReconnect: false }
  }

  if (missingTeamColumn) {
    result = await supabase
      .from('players')
      .select('id, nickname')
      .eq('game_id', gameId)
      .eq('reconnect_token', reconnectToken)
      .maybeSingle()
  }

  return { ...result, supportsReconnect: true }
}

async function insertPlayer(
  supabase: ReturnType<typeof createAdminClient>,
  gameId: string,
  nickname: string,
  teamCode: string,
  reconnectToken: string
) {
  let result = await supabase
    .from('players')
    .insert({
      game_id: gameId,
      nickname,
      team_code: teamCode,
      reconnect_token: reconnectToken,
    })
    .select('id, nickname, team_code')
    .single()

  const errorMessage = result.error?.message ?? ''
  const missingColumn = result.error?.code === 'PGRST204'
  const missingReconnectColumn = missingColumn && errorMessage.includes('reconnect_token')
  const missingTeamColumn = missingColumn && errorMessage.includes('team_code')

  if (missingReconnectColumn) {
    result = await supabase
      .from('players')
      .insert({
        game_id: gameId,
        nickname,
        team_code: teamCode,
      })
      .select('id, nickname, team_code')
      .single()

    return { ...result, supportsReconnect: false }
  }

  if (missingTeamColumn) {
    result = await supabase
      .from('players')
      .insert({
        game_id: gameId,
        nickname,
        reconnect_token: reconnectToken,
      })
      .select('id, nickname')
      .single()

    return { ...result, supportsReconnect: true }
  }

  return { ...result, supportsReconnect: true }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const pin = String(body.pin || '').trim().toUpperCase()
    const nickname = String(body.nickname || '').trim().slice(0, 20)
    const requestedTeamCode = normalizeTeamCode(String(body.teamCode || ''))
    const reconnectToken = String(body.reconnectToken || '').trim()

    if (!pin || !nickname) {
      return NextResponse.json({ error: 'PIN and nickname are required.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    let { data: game, error: gameError } = await supabase
      .from('games')
      .select('id, status, mode')
      .eq('pin', pin)
      .single()

    // Fall back for databases that have not run 009_add_game_mode.sql yet
    if (gameError && gameError.message.includes('mode')) {
      ;({ data: game, error: gameError } = await supabase
        .from('games')
        .select('id, status')
        .eq('pin', pin)
        .single())
    }

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found.' }, { status: 404 })
    }

    const teamGame = !('mode' in game) || game.mode !== 'classic'

    if (teamGame && !requestedTeamCode) {
      return NextResponse.json({ error: 'PIN, nickname, and team code are required.' }, { status: 400 })
    }

    // Classic games ignore team codes; players fall into the default bucket.
    const teamCode = teamGame ? requestedTeamCode : 'GENERAL'

    if (reconnectToken) {
      const { data: existingPlayer } = await findExistingPlayer(supabase, game.id, reconnectToken)

      if (existingPlayer) {
        return NextResponse.json({
          playerId: existingPlayer.id,
          nickname: existingPlayer.nickname,
          teamCode: existingPlayer.team_code ?? null,
          reconnectToken,
          reconnected: true,
        })
      }
    }

    if (game.status !== 'waiting') {
      return NextResponse.json({ error: 'This game has already started.' }, { status: 409 })
    }

    const token = reconnectToken || crypto.randomUUID()

    const { data: player, error: playerError, supportsReconnect } = await insertPlayer(
      supabase,
      game.id,
      nickname,
      teamCode,
      token
    )

    if (playerError || !player) {
      return NextResponse.json(
        { error: playerError?.message ?? 'Failed to join game.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      playerId: player.id,
      nickname: player.nickname,
      teamCode: player.team_code ?? teamCode,
      reconnectToken: supportsReconnect ? token : null,
      reconnected: false,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to join game.' },
      { status: 500 }
    )
  }
}

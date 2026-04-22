import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function findExistingPlayer(supabase: ReturnType<typeof createAdminClient>, gameId: string, reconnectToken: string) {
  let result = await supabase
    .from('players')
    .select('id, nickname')
    .eq('game_id', gameId)
    .eq('reconnect_token', reconnectToken)
    .maybeSingle()

  const missingReconnectColumn =
    result.error?.code === 'PGRST204' && result.error.message.includes('reconnect_token')

  if (missingReconnectColumn) {
    return { data: null, error: null, supportsReconnect: false }
  }

  return { ...result, supportsReconnect: true }
}

async function insertPlayer(
  supabase: ReturnType<typeof createAdminClient>,
  gameId: string,
  nickname: string,
  reconnectToken: string
) {
  let result = await supabase
    .from('players')
    .insert({
      game_id: gameId,
      nickname,
      reconnect_token: reconnectToken,
    })
    .select('id, nickname')
    .single()

  const missingReconnectColumn =
    result.error?.code === 'PGRST204' && result.error.message.includes('reconnect_token')

  if (missingReconnectColumn) {
    result = await supabase
      .from('players')
      .insert({
        game_id: gameId,
        nickname,
      })
      .select('id, nickname')
      .single()

    return { ...result, supportsReconnect: false }
  }

  return { ...result, supportsReconnect: true }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const pin = String(body.pin || '').trim().toUpperCase()
    const nickname = String(body.nickname || '').trim().slice(0, 20)
    const reconnectToken = String(body.reconnectToken || '').trim()

    if (!pin || !nickname) {
      return NextResponse.json({ error: 'PIN and nickname are required.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id, status')
      .eq('pin', pin)
      .single()

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found.' }, { status: 404 })
    }

    if (reconnectToken) {
      const { data: existingPlayer } = await findExistingPlayer(supabase, game.id, reconnectToken)

      if (existingPlayer) {
        return NextResponse.json({
          playerId: existingPlayer.id,
          nickname: existingPlayer.nickname,
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

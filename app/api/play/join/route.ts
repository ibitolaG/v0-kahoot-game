import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id, nickname')
        .eq('game_id', game.id)
        .eq('reconnect_token', reconnectToken)
        .maybeSingle()

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

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({
        game_id: game.id,
        nickname,
        reconnect_token: token,
      })
      .select('id, nickname')
      .single()

    if (playerError || !player) {
      return NextResponse.json({ error: 'Failed to join game.' }, { status: 500 })
    }

    return NextResponse.json({
      playerId: player.id,
      nickname: player.nickname,
      reconnectToken: token,
      reconnected: false,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to join game.' },
      { status: 500 }
    )
  }
}

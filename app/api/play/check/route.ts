import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const pin = url.searchParams.get('pin')?.trim().toUpperCase()
  const reconnectToken = url.searchParams.get('reconnectToken')?.trim()

  if (!pin) {
    return NextResponse.json({ gameExists: false, error: 'PIN is required.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: game, error } = await supabase
    .from('games')
    .select('id, status, max_players')
    .eq('pin', pin)
    .maybeSingle()

  if (error || !game) {
    return NextResponse.json({ gameExists: false, error: 'Game not found.' }, { status: 404 })
  }

  if (reconnectToken) {
    const { data: existingPlayer } = await supabase
      .from('players')
      .select('id')
      .eq('game_id', game.id)
      .eq('reconnect_token', reconnectToken)
      .maybeSingle()

    if (existingPlayer && game.status !== 'finished') {
      return NextResponse.json({
        gameExists: true,
        maxPlayers: game.max_players,
        rejoinAvailable: true,
      })
    }
  }

  if (game.status !== 'waiting') {
    return NextResponse.json({ gameExists: false, error: 'This game has already started.' }, { status: 409 })
  }

  return NextResponse.json({
    gameExists: true,
    maxPlayers: game.max_players,
    rejoinAvailable: false,
  })
}

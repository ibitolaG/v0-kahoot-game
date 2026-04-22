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
    return { data: null, error: null }
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
  const { data: game, error } = await supabase
    .from('games')
    .select('id, status')
    .eq('pin', pin)
    .maybeSingle()

  if (error || !game) {
    return NextResponse.json({ gameExists: false, error: 'Game not found.' }, { status: 404 })
  }

  if (reconnectToken) {
    const { data: existingPlayer } = await findExistingPlayer(supabase, game.id, reconnectToken)

    if (existingPlayer && game.status !== 'finished') {
      return NextResponse.json({
        gameExists: true,
        rejoinAvailable: true,
      })
    }
  }

  if (game.status !== 'waiting') {
    return NextResponse.json({ gameExists: false, error: 'This game has already started.' }, { status: 409 })
  }

  return NextResponse.json({
    gameExists: true,
    rejoinAvailable: false,
  })
}

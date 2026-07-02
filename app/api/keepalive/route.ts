import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Pinged daily by the Vercel cron in vercel.json. A lightweight read counts
// as activity, so the Supabase free tier never pauses the database.
export async function GET() {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('quizzes')
      .select('id', { count: 'exact', head: true })
      .limit(1)

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Keepalive failed.' },
      { status: 500 }
    )
  }
}

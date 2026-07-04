'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Renders a QR code linking straight to the join page for a game PIN.
// Always black-on-white inside a white tile so any phone camera can read it.
export function JoinQrCode({ url, className }: { url: string; className?: string }) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [url])

  if (!dataUrl) return null

  return (
    <div className={className}>
      <div className="rounded-2xl bg-white p-3 shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt={`QR code to join at ${url}`} className="h-40 w-40 md:h-48 md:w-48" />
      </div>
      <p className="mt-2 text-center text-sm text-muted-foreground">Scan to join</p>
    </div>
  )
}

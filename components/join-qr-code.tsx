'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// QR code linking straight to the join page for a game PIN. Click to enlarge.
// The code itself stays black-on-white in both themes — inverted QR codes fail
// on many phone cameras — but the frame adapts to the current theme.
export function JoinQrCode({ url, pin }: { url: string; pin?: string }) {
  const [dataUrl, setDataUrl] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, {
      width: 960,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [url])

  if (!dataUrl) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Enlarge QR code"
        className="group cursor-pointer"
      >
        <div className="rounded-2xl bg-white p-3 shadow-lg ring-1 ring-border transition-transform duration-200 group-hover:scale-105 group-active:scale-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={`QR code to join at ${url}`} className="h-52 w-52 md:h-60 md:w-60" />
        </div>
        <p className="mt-2 text-center text-sm text-muted-foreground">Scan to join &middot; tap to enlarge</p>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-fit max-w-[95vw] border-border bg-card p-8">
          <DialogTitle className="text-center text-3xl font-black">Scan to join</DialogTitle>
          <div className="mx-auto rounded-3xl bg-white p-5 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dataUrl}
              alt={`QR code to join at ${url}`}
              className="h-[min(65vh,65vw,34rem)] w-[min(65vh,65vw,34rem)]"
            />
          </div>
          {pin && (
            <div className="text-center font-mono text-5xl font-bold tracking-widest text-primary">
              {pin}
            </div>
          )}
          <p className="text-center text-sm text-muted-foreground">{url}</p>
        </DialogContent>
      </Dialog>
    </>
  )
}

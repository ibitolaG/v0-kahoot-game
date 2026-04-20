import Image from 'next/image'
import { cn } from '@/lib/utils'

interface BrandProps {
  showText?: boolean
  className?: string
  logoClassName?: string
  textClassName?: string
}

export function Brand({
  showText = true,
  className,
  logoClassName,
  textClassName,
}: BrandProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Image
        src="/cci-leeds-logo.png"
        alt="CCI Leeds"
        width={56}
        height={24}
        className={cn('h-8 w-auto object-contain', logoClassName)}
        priority
      />
      {showText && (
        <div className={cn('leading-none', textClassName)}>
          <div className="text-base font-bold uppercase tracking-[0.18em] text-primary">CCI Leeds</div>
          <div className="text-lg font-bold text-foreground">Quiz Arena</div>
        </div>
      )}
    </div>
  )
}

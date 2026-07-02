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
      {/* Theme-specific logos: black wordmark for light mode, white for dark */}
      <Image
        src="/cci-leeds-logo-light.png"
        alt="CCI Leeds"
        width={56}
        height={24}
        className={cn('h-8 w-auto object-contain dark:hidden', logoClassName)}
        priority
      />
      <Image
        src="/cci-leeds-logo-dark.png"
        alt="CCI Leeds"
        width={56}
        height={24}
        className={cn('hidden h-8 w-auto object-contain dark:block', logoClassName)}
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

import { cn } from '@/lib/utils'

/**
 * beautifului.dev's Loading State, "Dots" variant, without the elapsed timer:
 * a 3×3 grid of dots lit in a wave that runs outward from the middle row,
 * beside a shimmering label.
 */
const DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3)
  return ((i % 3) + Math.abs(row - 1)) * 90
})

export const LoadingState = ({
  label = 'Thinking',
  className,
}: {
  label?: string
  className?: string
}) => (
  <div role="status" className={cn('flex w-fit items-center gap-2.5', className)}>
    <span aria-hidden="true" className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {DELAYS.map((delay, i) => (
        <span
          key={i}
          className="loading-dot size-1 rounded-full bg-foreground"
          style={{
            opacity: 0.15,
            animation: `pixel-on 650ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
    <span
      className="shimmer-text bg-clip-text text-sm font-medium text-transparent"
      style={{
        backgroundImage:
          'linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer-text 1.4s linear infinite',
      }}
    >
      {label}
    </span>
  </div>
)

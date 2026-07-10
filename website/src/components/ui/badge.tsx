import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

type BadgeVariant = 'default' | 'secondary' | 'outline'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly variant?: BadgeVariant
}

export const Badge = ({ className, variant = 'default', ...props }: BadgeProps) => (
  <span className={cn('ui-badge', `ui-badge-${variant}`, className)} {...props} />
)

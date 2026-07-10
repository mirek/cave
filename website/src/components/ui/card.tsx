import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('ui-card', className)} {...props} />
)

import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

export const Input = ({ className, type = 'text', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input type={type} className={cn('ui-input', className)} {...props} />
)

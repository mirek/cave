import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'link'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
}

export const Button = ({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}
    {...props}
  />
)

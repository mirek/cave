import type { AnchorHTMLAttributes, ComponentProps } from 'react'
import { cn } from '../../lib/utils.ts'

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'link'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

type ButtonProps = ComponentProps<'button'> & {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
}

export const ButtonLink = ({ className, variant = 'default', size = 'default', ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
}) => <a className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)} {...props} />

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

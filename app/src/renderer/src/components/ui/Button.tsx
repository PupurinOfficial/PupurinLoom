import { type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'xs' | 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-loom-accent text-loom-bg hover:opacity-90 font-semibold',
  secondary: 'bg-loom-panel border border-loom-border text-loom-text hover:bg-loom-panel2',
  ghost: 'bg-transparent text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10',
  danger: 'bg-loom-err/10 border border-loom-err/40 text-loom-err hover:bg-loom-err/20',
}

const SIZE_CLASS: Record<Size, string> = {
  xs: 'px-2.5 py-1 text-[11px] rounded',
  sm: 'px-3 py-1.5 text-xs rounded',
  md: 'px-4 py-2 text-sm rounded-lg',
}

// 统一按钮：主按钮（金色实心）/ 次按钮（面板+描边）/ 幽灵按钮（图标）/ 危险按钮
export default function Button({
  variant = 'primary',
  size = 'sm',
  icon,
  loading,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const busy = loading ?? false
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={[
        'flex items-center gap-1 transition-colors select-none',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      ].join(' ')}
    >
      {busy ? (
        <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}

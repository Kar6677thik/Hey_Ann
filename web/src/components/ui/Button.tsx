import type { ButtonHTMLAttributes, ComponentType, ReactNode, Ref } from 'react';
import { cn } from './cn.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'sm' | 'md';

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium select-none transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink hover:opacity-90 rounded-full',
  secondary: 'border border-border-strong bg-transparent text-text hover:bg-raised hover:border-control rounded-md',
  ghost: 'text-muted hover:text-text hover:bg-raised rounded-md',
  quiet: 'text-muted hover:text-text rounded-md',
  danger: 'border border-[color-mix(in_oklab,var(--negative)_45%,transparent)] text-[var(--pill-negative-ink)] hover:bg-[var(--pill-negative-bg)] rounded-md',
};
const sizes: Record<Size, string> = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-sm' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: Variant;
  size?: Size;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {Icon ? <Icon size={size === 'sm' ? 13 : 14} strokeWidth={1.75} aria-hidden /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;
  size?: 'sm' | 'md';
}
/** Icon-only button: always has an accessible name and a hover title. */
export function IconButton({ label, icon: Icon, size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  const box = size === 'sm' ? 'size-7' : 'size-8';
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-raised hover:text-text disabled:opacity-40', box, className)}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

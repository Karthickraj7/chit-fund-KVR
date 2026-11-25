import React, { useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CheckCircle2, XCircle, Clock, ShieldCheck, X } from 'lucide-react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
  const variants: Record<string, string> = {
    primary:
      'bg-[#0B1220] text-white hover:bg-[#192338] dark:bg-emerald-500 dark:text-[#04120B] dark:hover:bg-emerald-400',
    accent:
      'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-500 dark:text-[#04120B] dark:hover:bg-emerald-400',
    secondary:
      'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/[0.11]',
    outline:
      'border border-slate-200/90 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-300 dark:border-white/[0.1] dark:bg-[#0F1624] dark:text-slate-200 dark:hover:bg-white/[0.04]',
    ghost:
      'text-slate-600 hover:text-slate-950 hover:bg-slate-100/80 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/[0.06]',
    danger:
      'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600/90 dark:hover:bg-red-500',
  };
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0F1624]',
        className
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between pb-5 border-b border-slate-200/75 dark:border-white/[0.07]">
      <div className="min-w-0">
        <h1 className="font-display text-2xl sm:text-[26px] font-semibold tracking-tight text-slate-950 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-xs sm:text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * Unboxed semantic status text (Zero-Pill Discipline).
 * Always pairs color with explicit label and icon for WCAG accessibility.
 */
export function StatusText({ status }: { status: string }) {
  const s = (status || '').toUpperCase();
  const isSuccess = [
    'ACTIVE',
    'VERIFIED',
    'PAID',
    'SUCCESSFUL',
    'RECONCILED',
    'APPROVED',
    'COMPLETED',
    'POSTED',
    'MATCHED',
    'DELIVERED_IN_APP',
    'PRIZED',
    'OPEN',
  ].includes(s);
  const isDanger = [
    'OVERDUE',
    'REJECTED',
    'FAILED',
    'BOUNCED',
    'REVERSED',
    'CANCELLED',
    'SUSPENDED',
    'DEFAULTED',
    'DISPUTED',
    'UNMATCHED',
  ].includes(s);
  const isWarning = [
    'PENDING',
    'PENDING_APPROVAL',
    'PENDING_VERIFICATION',
    'UNDER_VERIFICATION',
    'PARTIAL',
    'DUE',
    'ADAPTER_UNCONFIGURED',
    'PAYABLE',
    'INITIATED',
    'SCHEDULED',
    'PROMISED',
  ].includes(s);

  const label = s.replace(/_/g, ' ');

  if (isSuccess) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (isDanger) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (isWarning) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

export function InputField({
  label,
  error,
  className,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
}) {
  const inputId = id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
      </label>
      <input
        id={inputId}
        className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 placeholder:text-slate-400 transition-colors focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-white/[0.1] dark:bg-[#0B1220] dark:text-slate-100 dark:focus:border-emerald-500"
        {...props}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function SelectField({
  label,
  children,
  className,
  id,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
}) {
  const selectId = id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={selectId}
        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
      </label>
      <select
        id={selectId}
        className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 transition-colors focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-white/[0.1] dark:bg-[#0B1220] dark:text-slate-100 dark:focus:border-emerald-500"
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070E]/65 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-xl border border-slate-200/90 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#0F1624]',
          wide ? 'max-w-3xl' : 'max-w-xl'
        )}
      >
        <div className="flex items-start justify-between border-b border-slate-200/80 px-6 py-4 dark:border-white/[0.08]">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-950 dark:text-white">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.08] dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

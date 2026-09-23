import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — the one page heading. It sits in normal flow under the TopBar
 * (which owns the breadcrumb and global utilities); nothing here is positioned.
 */
export interface PageHeaderProps {
  title: ReactNode;
  /** Entity visual before the title (product image, avatar). */
  leading?: ReactNode;
  /** Short context above the title (SKU, "Revisar antes de emitir"). */
  eyebrow?: ReactNode;
  /** Operational context only (period, count). Never a slogan or tutorial. */
  description?: ReactNode;
  /** Status, revision, dates: a wrapping row under the title. */
  meta?: ReactNode;
  /** Page actions, secondary → primary. */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, leading, eyebrow, description, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="flex min-w-0 flex-1 basis-80 items-center gap-4">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="mb-1 text-[13px] font-medium text-fg-muted">{eyebrow}</div>}
          <h1 className="break-words text-[28px] font-bold leading-[1.2] tracking-[-0.035em] text-fg max-md:text-[22px]">
            {title}
          </h1>
          {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
          {meta && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-fg-muted">{meta}</div>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

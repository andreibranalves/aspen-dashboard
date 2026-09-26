import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageActionsSlot } from '@/components/layout/PageActionsSlot';
import { cn } from '@/lib/utils';

/**
 * PageHeader — the one page heading. The breadcrumb in the TopBar names the
 * page, so the `h1` is for screen readers only and `actions` render in the
 * TopBar. What stays in the page is the entity context row (leading visual,
 * eyebrow, description, meta), in normal flow; nothing here is positioned.
 */
export interface PageHeaderProps {
  title: ReactNode;
  /** Entity visual at the start of the context row (product image, avatar). */
  leading?: ReactNode;
  /** Short context first in the row (SKU, "Revisar antes de emitir"). */
  eyebrow?: ReactNode;
  /** Operational context only (period, count). Never a slogan or tutorial. */
  description?: ReactNode;
  /** Status, revision, dates. */
  meta?: ReactNode;
  /** Page actions, secondary → primary; rendered in the TopBar. */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, leading, eyebrow, description, meta, actions, className }: PageHeaderProps) {
  const actionsSlot = usePageActionsSlot();
  const heading = <h1 className="sr-only">{title}</h1>;
  const inlineActions = actions && actionsSlot === undefined;
  const portaledActions = actions && actionsSlot ? createPortal(actions, actionsSlot) : null;

  if (!leading && !eyebrow && !description && !meta && !inlineActions) {
    return (
      <>
        {heading}
        {portaledActions}
      </>
    );
  }

  return (
    <header className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-3', className)}>
      {heading}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-compact text-fg-muted">
          {eyebrow && <span className="font-medium">{eyebrow}</span>}
          {description}
          {meta}
        </div>
      </div>
      {inlineActions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {portaledActions}
    </header>
  );
}

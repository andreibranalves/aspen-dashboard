import type { ReactNode } from 'react';
import PageShell from '@/components/shared/PageShell';
import PageToolbar from '@/components/shared/PageToolbar';
import { cn } from '@/lib/utils';

/**
 * ListPageLayout — ritmo das páginas de lista: cabeçalho, resumo opcional, ListSection
 * e sobreposições (BulkActionBar, gavetas, diálogos).
 * Estado, busca e seleção permanecem em cada página.
 */
export interface ListPageLayoutProps {
  header?: ReactNode;
  children: ReactNode;
}

export default function ListPageLayout({ header, children }: ListPageLayoutProps) {
  return (
    <PageShell className="space-y-6">
      {header}
      {children}
    </PageShell>
  );
}

export interface ListSectionProps {
  /** aria-label da região. */
  label: string;
  toolbar: ReactNode;
  children: ReactNode;
  pagination?: ReactNode;
  /** false quando o conteúdo já é uma grade de cards. */
  surface?: boolean;
}

export function ListSection({ label, toolbar, children, pagination, surface = true }: ListSectionProps) {
  return (
    <section aria-label={label} className={cn('flex flex-col gap-5', surface && 'rounded-card bg-surface p-5')}>
      <PageToolbar>{toolbar}</PageToolbar>
      {children}
      {pagination}
    </section>
  );
}

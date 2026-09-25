import type { CSSProperties } from 'react';
import Skeleton from '@/components/shared/Skeleton';

export interface SkeletonTableProps {
  cols?: number;
  rows?: number;
  size?: 'sm' | 'md' | 'lg';
}

/** Reserves the list's space as one shape, without drawing placeholder table rows. */
export default function SkeletonTable({ rows = 8, size = 'md' }: SkeletonTableProps) {
  const rowHeight = size === 'sm' ? 40 : size === 'lg' ? 64 : 56;

  return (
    <div role="status" aria-busy="true" aria-label="Carregando lista" className="w-full">
      <Skeleton className="h-(--skeleton-h) w-full" variant="card"
        style={{ '--skeleton-h': `${40 + rows * rowHeight}px` } as CSSProperties} />
    </div>
  );
}

import Skeleton from '@/components/shared/Skeleton';
import PageShell from '@/components/shared/PageShell';

/** Reserves the main regions of detail pages without drawing placeholder fields. */
export default function SkeletonDetail() {
  return (
    <PageShell aria-busy="true" aria-label="Carregando detalhes">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-[84px]" variant="card" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[88px]" variant="card" />
        ))}
      </div>
      <Skeleton className="h-[360px]" variant="card" />
      <Skeleton className="h-[88px]" variant="card" />
    </PageShell>
  );
}

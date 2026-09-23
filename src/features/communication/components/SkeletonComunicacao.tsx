import Skeleton from '@/components/shared/Skeleton';

/** Shape placeholders sized to the three Communication layouts. */
export default function SkeletonComunicacao({ variant = 'cards' }: { variant?: 'cards' | 'editor' | 'list' }) {
  if (variant === 'editor') {
    return (
      <div className="space-y-5" role="status" aria-busy="true" aria-label="Carregando fluxos">
        <Skeleton className="h-12 w-64 max-w-full rounded-control" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <Skeleton className="h-[520px] rounded-card" />
          <Skeleton className="h-[520px] rounded-card" />
        </div>
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Carregando histórico">
        <Skeleton className="h-10 w-full rounded-card" />
        <Skeleton className="h-[450px] rounded-card" />
      </div>
    );
  }

  return (
    <div role="status" aria-busy="true" aria-label="Carregando mídias" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-[210px] rounded-card" />
      ))}
    </div>
  );
}

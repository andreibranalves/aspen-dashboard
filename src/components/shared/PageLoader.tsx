import PageShell from '@/components/shared/PageShell';
import Skeleton from '@/components/shared/Skeleton';

export default function PageLoader() {
  return (
    <PageShell>
      <div role="status" aria-busy="true" aria-label="Carregando página" className="space-y-5">
        <Skeleton className="h-12 w-64 max-w-full rounded-control" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[145px] rounded-card" />
          ))}
        </div>
        <Skeleton className="h-[400px] rounded-card" />
      </div>
    </PageShell>
  );
}

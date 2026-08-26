import Skeleton from '@/components/shared/Skeleton';

/** Skeleton shared by the remotely loaded Communication sections. */
export default function SkeletonComunicacao() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando comunicação">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 max-w-full opacity-70" />
        </div>
        <Skeleton className="h-9 w-24 rounded-sm" />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-md border border-line bg-surface p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="ml-auto h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-3 w-48 opacity-70" />
            <div className="flex gap-2 border-t border-line pt-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-28 opacity-70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

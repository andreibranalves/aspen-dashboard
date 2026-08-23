import Skeleton from '@/components/shared/Skeleton';

/**
 * SkeletonComunicacao — skeleton da página de Comunicação.
 * Espelha ComunicacaoPage: PageHeader, tab bar e conteúdo da aba ativa.
 */
export default function SkeletonComunicacao() {
  return (
    <div
      className="space-y-6 max-w-[1060px] mx-auto"
      aria-busy="true"
      aria-label="Carregando comunicação"
    >
      {/* Page header — text-2xl font-semibold */}
      <Skeleton className="h-8 w-48" />

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-4 py-2.5 border-b-2 -mb-[1px] border-transparent"
          >
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className={`h-4 ${i === 0 ? 'w-28' : 'w-24'}`} />
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>

        <div className="bg-surface rounded-lg border border-line shadow-sm p-5 space-y-4">
          <div className="flex items-start gap-4">
            <Skeleton className="h-16 w-16 rounded-lg shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-1/2 opacity-70" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

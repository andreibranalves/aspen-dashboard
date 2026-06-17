import Skeleton from '@/components/Skeleton.jsx';

/**
 * SkeletonDetail — simula uma página de detalhe durante o carregamento.
 * Header + seções com blocos de key-value e uma tabela de itens.
 *
 * @param {string} title - Texto de carregamento
 */
export default function SkeletonDetail({ title = 'Carregando…' }) {
  return (
    <div className="flex flex-col items-center gap-3" aria-label="Carregando detalhes">
      {/* Back button placeholder */}
      <div className="self-start">
        <Skeleton className="h-5 w-28" />
      </div>

      {/* Detail card */}
      <div className="bg-surface rounded-lg border border-line shadow-sm w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>

        {/* Customer info section */}
        <div className="px-6 py-4 border-b">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-48" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-5 w-36" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="px-6 py-4 border-b">
          <Skeleton className="h-5 w-24 mb-3" />
          <div className="border rounded-md">
            {/* Table header */}
            <div className="px-4 py-2 border-b bg-surface-muted/30 flex gap-4">
              <Skeleton className="h-5 w-[30%]" />
              <Skeleton className="h-5 w-[15%]" />
              <Skeleton className="h-5 w-[12%]" />
              <Skeleton className="h-5 w-[12%]" />
              <Skeleton className="h-5 w-[15%] ml-auto" />
            </div>
            {/* Table rows */}
            <div className="divide-y">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="px-4 py-3 flex gap-4">
                  <Skeleton className="h-5 w-[30%]" />
                  <Skeleton className="h-5 w-[15%]" />
                  <Skeleton className="h-5 w-[12%]" />
                  <Skeleton className="h-5 w-[12%]" />
                  <Skeleton className={`h-5 w-[15%] ml-auto ${i % 2 === 1 ? 'opacity-40' : ''}`} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Totals section */}
        <div className="px-6 py-4 flex justify-end gap-8">
          <div className="space-y-1 text-right">
            <Skeleton className="h-4 w-20 ml-auto" />
            <Skeleton className="h-6 w-28 ml-auto" />
          </div>
        </div>
      </div>
      <p className="text-fg-muted text-sm">{title}</p>
    </div>
  );
}

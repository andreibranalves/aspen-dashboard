import Skeleton from '@/components/shared/Skeleton';
import { PIPELINE } from '@/lib/constants';

/** The loading board keeps the same column width and spacing as the populated board. */
export default function SkeletonKanban() {
  return (
    <div role="status" className="overflow-x-auto rounded-card" aria-busy="true" aria-label="Carregando pipeline CRM">
      <div className="flex w-max min-w-full gap-3">
        {PIPELINE.map((status) => (
          <Skeleton key={status} className="h-[55vh] w-[13.5rem] shrink-0 rounded-card" />
        ))}
      </div>
    </div>
  );
}

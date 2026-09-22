import { cn } from '@/lib/utils';

export default function AspenBrand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 text-[26px] font-extrabold tracking-[-0.06em]',
        className
      )}
      aria-label="Aspen CRM"
    >
      <svg
        viewBox="0 0 32 34"
        fill="none"
        className="h-[31px] w-[29px] shrink-0"
        aria-hidden="true"
      >
        <path
          d="M3 29 15.5 4 29 29H3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 22h14M12 16h8M16 5v24" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span aria-hidden="true">
        aspen
        <small className="ml-1 align-baseline text-[9px] font-semibold uppercase tracking-[0.17em] opacity-55">
          CRM
        </small>
      </span>
    </span>
  );
}

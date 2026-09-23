import { cn } from '@/lib/utils';
import aspenLogo from '@/assets/aspen-logo.svg';

export default function AspenBrand({ className }: { className?: string }) {
  return (
    <img
      src={aspenLogo}
      alt="Aspen CRM"
      className={cn(
        'h-[31px] w-auto shrink-0',
        className
      )}
    />
  );
}

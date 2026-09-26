import { cn } from '@/lib/utils';
import aspenLogo from '@/assets/aspen-logo.svg';
import aspenLogoDark from '@/assets/aspen-logo-dark.svg';

export default function AspenBrand({ className }: { className?: string }) {
  return (
    <>
      <img src={aspenLogo} alt="Aspen CRM" className={cn('h-[34px] w-auto shrink-0 dark:hidden', className)} />
      <img src={aspenLogoDark} alt="Aspen CRM" className={cn('hidden h-[34px] w-auto shrink-0 dark:block', className)} />
    </>
  );
}

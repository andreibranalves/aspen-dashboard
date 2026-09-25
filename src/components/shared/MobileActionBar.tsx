import type { ReactNode } from 'react';

/**
 * MobileActionBar — ação primária fixa no rodapé abaixo de `md`, acima da
 * navegação inferior. No desktop as mesmas ações ficam no header ou no painel.
 */
export default function MobileActionBar({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <div aria-hidden="true" className="h-20 md:hidden" />
      <div
        role="region"
        aria-label={label}
        className="fixed inset-x-0 bottom-(--mobile-nav-h) z-floating border-t border-line bg-surface/95 px-4 py-3 shadow-bar backdrop-blur md:hidden"
      >
        <div className="flex items-center gap-2 *:flex-1">{children}</div>
      </div>
    </>
  );
}

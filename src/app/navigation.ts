import type { LucideIcon } from 'lucide-react';
import { routes, type AppRoute } from '@/app/routes';

type NavConfig = NonNullable<AppRoute['nav']>;

export interface NavItem {
  hash: string;
  label: string;
  icon: LucideIcon;
  group?: NavConfig['group'];
  bottom?: number;
}

function navItems(placement: NavConfig['placement']): NavItem[] {
  return routes
    .filter((route) => route.nav?.placement === placement)
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
    .map((route) => ({
      hash: route.path,
      label: route.nav!.label,
      icon: route.nav!.icon,
      group: route.nav!.group,
      bottom: route.nav!.bottom,
    }));
}

export const NAV_ACTION = navItems('action')[0] ?? null;
export const NAV_DESTINATIONS = navItems('destination');
export const NAV_FOOTER = navItems('footer');

const GROUP_LABELS: Record<NonNullable<NavConfig['group']>, string> = {
  operacao: 'Operação',
  cadastros: 'Cadastros',
  acompanhamento: 'Acompanhamento',
};

/** Destinos da sidebar agrupados, na ordem dos grupos. */
export const NAV_GROUPS = (Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map((id) => ({
  id,
  label: GROUP_LABELS[id],
  items: NAV_DESTINATIONS.filter((item) => item.group === id),
}));

/** Destinos fixos da barra inferior do celular; o resto fica em "Mais". */
export const NAV_BOTTOM = NAV_DESTINATIONS.filter((item) => item.bottom !== undefined).sort(
  (a, b) => (a.bottom ?? 0) - (b.bottom ?? 0)
);

/** Destino ativo para uma rota: fluxos filhos acendem o item-pai. */
export function activeNavHash(path: string): string {
  if (path.startsWith('/products')) return '/catalog';
  if (path === '/auto' || path === '/manual') return '/novo-orcamento';
  return path;
}

export function isNavActive(item: NavItem, path: string): boolean {
  const active = activeNavHash(path);
  return active === item.hash || active.startsWith(`${item.hash}/`);
}

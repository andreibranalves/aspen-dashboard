import type { LucideIcon } from 'lucide-react';
import { routes } from '@/app/routes';

export interface NavItem {
  hash: string;
  label: string;
  icon: LucideIcon;
}

function navItems(placement: 'action' | 'destination' | 'footer'): NavItem[] {
  return routes
    .filter((route) => route.nav?.placement === placement)
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
    .map((route) => ({
      hash: route.path,
      label: route.nav!.label,
      icon: route.nav!.icon,
    }));
}

export const NAV_ACTION = navItems('action')[0] ?? null;
export const NAV_DESTINATIONS = navItems('destination');
export const NAV_FOOTER = navItems('footer');

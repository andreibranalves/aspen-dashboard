import type { LucideIcon } from 'lucide-react';
import { routes } from '@/app/routes';

export interface NavItem {
  hash: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = routes.reduce<NavSection[]>((sections, route) => {
  if (!route.nav) return sections;
  const section = sections.find((s) => s.title === route.nav!.section);
  if (section) {
    section.items.push({ hash: route.path, label: route.nav!.label, icon: route.nav!.icon });
  } else {
    sections.push({
      title: route.nav!.section,
      items: [{ hash: route.path, label: route.nav!.label, icon: route.nav!.icon }],
    });
  }
  return sections;
}, []);

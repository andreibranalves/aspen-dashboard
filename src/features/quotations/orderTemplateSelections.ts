import type { OrderTemplate } from '@/lib/api/orderTemplatesApi';

export function templateSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function inlineTemplateSelections(text: string, templates: OrderTemplate[]) {
  const bySlug = new Map(templates.map((template) => [templateSlug(template.name), template]));
  const selections: Array<{ id: string; quantity: number }> = [];
  const unknown: string[] = [];
  const quantity = String.raw`\d+(?:[.,]\d+)?`;
  const quantityPattern = new RegExp(quantity, 'gu');
  const mentionPattern = new RegExp(
    String.raw`(?:^|\s)((?:${quantity}\s*(?:,|e)\s*)*${quantity})\s*@([\p{L}\p{N}_-]+)(?!\.[\p{L}\p{N}_-]+)`,
    'giu'
  );

  for (const match of text.matchAll(mentionPattern)) {
    const template = bySlug.get(templateSlug(match[2]));
    if (!template) {
      unknown.push(`@${match[2]}`);
      continue;
    }
    for (const value of match[1].match(quantityPattern) ?? []) {
      selections.push({ id: template.id, quantity: Number(value.replace(',', '.')) });
    }
  }
  return { selections, unknown };
}

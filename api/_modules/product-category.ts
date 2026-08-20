const PRODUCT_CATEGORY_BY_PREFIX: Record<string, string> = {
  CNG: 'canga',
  LNC: 'lenço',
  BNE: 'boné',
  TBH: 'toalha',
  TWL: 'toalha',
  CHP: 'chapéu',
  ECO: 'ecobag',
  CHC: 'cachecol',
};

const CATEGORY_ALIASES: Record<string, string> = {
  canga: 'canga',
  cangas: 'canga',
  lenco: 'lenço',
  lenço: 'lenço',
  lenços: 'lenço',
  bone: 'boné',
  boné: 'boné',
  bonés: 'boné',
  chapeu: 'chapéu',
  chapéu: 'chapéu',
  chapéus: 'chapéu',
  toalha: 'toalha',
  toalhas: 'toalha',
  ecobag: 'ecobag',
  ecobags: 'ecobag',
  cachecol: 'cachecol',
  cachecóis: 'cachecol',
  cachecois: 'cachecol',
};

export function normalizeProductCategory(value: unknown): string {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CATEGORY_ALIASES[key] || key;
}

function firstCategoryValue(item: Record<string, unknown>): unknown {
  return [
    item.categoria,
    item.category,
    item.produtoCategoria,
    item.product_category,
    item.productCategory,
    item.product_group,
    item.productGroup,
  ].find((value) => typeof value === 'string' && value.trim());
}

export function detectProductCategories(items: Array<Record<string, unknown>> = []): string[] {
  const categories: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rawCategory = firstCategoryValue(item);
    const category = rawCategory
      ? normalizeProductCategory(rawCategory)
      : PRODUCT_CATEGORY_BY_PREFIX[
          String(
            item.sku || item.item_code || item.itemCode || item.produtoSku || item.productSku || ''
          )
            .trim()
            .toUpperCase()
            .split('-')[0] || ''
        ] || '';
    if (category && !categories.includes(category)) categories.push(category);
  }
  return categories;
}

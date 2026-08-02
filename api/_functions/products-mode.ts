/**
 * Products rollout switch. Deliberately checks for the exact string `true` so
 * an unset, empty, or malformed environment variable always remains on the
 * preserved Frappe implementation.
 */
export function isProductsCoreEnabled(): boolean {
  return process.env.CRM_CORE_PRODUCTS_ENABLED === 'true';
}
export const PRODUCT_CORE_SOURCE = 'postgres' as const;
export const PRODUCT_LEGACY_SOURCE = 'frappe' as const;

export type ProductResponseMode = 'core' | 'legacy';

export function responseMetadata(mode: ProductResponseMode): {
  core_mode: boolean;
  source: typeof PRODUCT_CORE_SOURCE | typeof PRODUCT_LEGACY_SOURCE;
} {
  return mode === 'core'
    ? { core_mode: true, source: PRODUCT_CORE_SOURCE }
    : { core_mode: false, source: PRODUCT_LEGACY_SOURCE };
}

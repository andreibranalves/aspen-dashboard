// src/hooks/useExtractionDrafts.ts
// Encapsulates draft state management: drafts array, pricing, mutations, product search.
// Extracted from AutoQuotePage.jsx.

import { useState, useCallback, useRef } from 'react';
import { apiPost } from '@/lib/api/api';
import { useToast } from '@/components/shared/toast';
import { isUnpricedProduct, searchProducts as cachedSearchProducts } from '@/lib/api/productCache';
import type {
  Draft,
  DraftEdited,
  DraftItem,
  Product,
  ProductSearchEntry,
} from '@/types/domain';
import {
  isValidLeadSource,
  normalizeCnpj,
  isValidCnpj,
  normalizeAddress,
  normalizeLeadSource,
} from '@/lib/clientMetadata';
import type { Address } from '@/lib/clientMetadata';

interface PricingItem {
  item_code: string;
  qty: number;
}

interface PricingRef {
  di: number;
  ii: number;
}

export function useExtractionDrafts(initialDrafts: Draft[] = []) {
  const { toast } = useToast();
  // ── State ──
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const draftsRef = useRef<Draft[]>(initialDrafts);
  draftsRef.current = drafts;
  const pricingVersionsRef = useRef<Record<number, number>>({});
  const [productSearch, setProductSearch] = useState<Record<number, ProductSearchEntry>>({});
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Pricing lookup ──
  const fetchPricing = useCallback(async (draftsList: Draft[], urgent: boolean): Promise<Draft[]> => {
    const allItems: PricingItem[] = [];
    const refs: PricingRef[] = [];
    for (let di = 0; di < draftsList.length; di++) {
      const items = draftsList[di].edited.items;
      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        if (it.item_code && it.qty > 0) {
          allItems.push({ item_code: it.item_code, qty: it.qty });
          refs.push({ di, ii });
        }
      }
    }
    if (allItems.length === 0) return draftsList;

    try {
      const res = await apiPost<{ success?: boolean; items?: { rate: number; item_name?: string }[] }>(
        '/pricing-lookup',
        { items: allItems, urgent },
      );
      if (!res.success || !Array.isArray(res.items)) return draftsList;

      const next = draftsList.map(d => ({
        ...d,
        edited: { ...d.edited, items: d.edited.items.map(it => ({ ...it })) },
      }));

      for (let i = 0; i < res.items.length && i < refs.length; i++) {
        const { di, ii } = refs[i];
        const rate = Number(res.items[i].rate);
        if (!next[di].edited.items[ii]._rateManual && Number.isFinite(rate) && rate > 0) {
          next[di].edited.items[ii].rate = rate;
        }
        if (!next[di].edited.items[ii].item_name && res.items[i].item_name) {
          next[di].edited.items[ii].item_name = res.items[i].item_name;
        }
      }
      return next;
    } catch (err) {
      console.warn('[pricing]', (err as Error).message);
      return draftsList;
    }
  }, []);

  const nextPricingVersion = useCallback((draftIdx: number): number => {
    const version = (pricingVersionsRef.current[draftIdx] || 0) + 1;
    pricingVersionsRef.current[draftIdx] = version;
    return version;
  }, []);

  const applyPricingResult = useCallback(
    (draftIdx: number, requested: Draft, priced: Draft, requestVersion: number) => {
      setDrafts(prev => {
        if (pricingVersionsRef.current[draftIdx] !== requestVersion) return prev;
        const currentIndex = prev.findIndex((draft) => draft.index === draftIdx);
        if (currentIndex < 0) return prev;
        const current = prev[currentIndex];
        if (current.edited.urgente !== requested.edited.urgente) return prev;
        const items = current.edited.items.map((item, itemIndex) => {
          const requestedItem = requested.edited.items[itemIndex];
          const pricedItem = priced.edited.items[itemIndex];
          if (!requestedItem || !pricedItem) return item;
          if (
            item.item_code !== requestedItem.item_code ||
            item.qty !== requestedItem.qty ||
            Boolean(item._rateManual) !== Boolean(requestedItem._rateManual)
          ) return item;
          return {
            ...item,
            rate: pricedItem.rate,
            item_name: item.item_name || pricedItem.item_name,
          };
        });
        const next = [...prev];
        next[currentIndex] = { ...current, edited: { ...current.edited, items } };
        return next;
      });
    },
    [],
  );

  // ── Draft item mutations ──
  const updateDraftItem = useCallback(
    (draftIdx: number, itemIdx: number, field: keyof DraftItem, value: unknown) => {
      nextPricingVersion(draftIdx);
      setDrafts(prev => {
        const draftIndex = prev.findIndex((draft) => draft.index === draftIdx);
        if (draftIndex < 0) return prev;
        const items = [...prev[draftIndex].edited.items];
        if (!items[itemIdx]) return prev;
        items[itemIdx] = { ...items[itemIdx], [field]: value } as DraftItem;
        if (field === 'rate') items[itemIdx]._rateManual = true;
        if (field === 'item_code') delete items[itemIdx]._rateManual;
        if (field === 'qty') delete items[itemIdx]._rateManual;
        const next = [...prev];
        next[draftIndex] = { ...next[draftIndex], edited: { ...next[draftIndex].edited, items } };
        return next;
      });
    },
    [nextPricingVersion],
  );

  const addDraftItem = useCallback((draftIdx: number) => {
    nextPricingVersion(draftIdx);
    setDrafts(prev => {
      const currentIndex = prev.findIndex((draft) => draft.index === draftIdx);
      if (currentIndex < 0) return prev;
      const items = [
        ...prev[currentIndex].edited.items,
        { item_code: '', qty: 30, rate: null, _rateManual: true } as DraftItem,
      ];
      const next = [...prev];
      next[currentIndex] = { ...next[currentIndex], edited: { ...next[currentIndex].edited, items } };
      return next;
    });
  }, [nextPricingVersion]);

  const removeDraftItem = useCallback((draftIdx: number, itemIdx: number) => {
    nextPricingVersion(draftIdx);
    setDrafts(prev => {
      const currentIndex = prev.findIndex((draft) => draft.index === draftIdx);
      if (currentIndex < 0) return prev;
      const items = prev[currentIndex].edited.items.filter((_, i) => i !== itemIdx);
      const next = [...prev];
      next[currentIndex] = { ...next[currentIndex], edited: { ...next[currentIndex].edited, items } };
      return next;
    });
  }, [nextPricingVersion]);

  // ── Draft field helpers ──
  const updateDraftField = useCallback(
    (draftIdx: number, field: keyof DraftEdited, value: unknown) => {
      setDrafts(prev => {
        const next = [...prev];
        next[draftIdx] = {
          ...next[draftIdx],
          edited: { ...next[draftIdx].edited, [field]: value },
        };
        return next;
      });
    },
    [],
  );

  const updateDraftAddressField = useCallback(
    (draftIdx: number, field: keyof Address, value: unknown) => {
      setDrafts(prev => {
        const next = [...prev];
        const addr = normalizeAddress({ ...next[draftIdx].edited.endereco, [field]: value });
        next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, endereco: addr } };
        return next;
      });
    },
    [],
  );

  // ── Urgente toggle (updates flag then re-prices) ──
  const handleUrgenteToggle = useCallback(
    async (draftIdx: number, checked: boolean) => {
      const current = draftsRef.current.find((draft) => draft.index === draftIdx);
      if (!current) return;
      const updated = { ...current, edited: { ...current.edited, urgente: checked } };
      const requestVersion = nextPricingVersion(draftIdx);
      setDrafts(prev => prev.map((draft) => (
        draft.index === draftIdx ? updated : draft
      )));
      const priced = await fetchPricing([updated], checked);
      applyPricingResult(draftIdx, updated, priced[0], requestVersion);
    },
    [applyPricingResult, fetchPricing, nextPricingVersion],
  );

  // ── Draft approval / discard ──
  const approveDraft = useCallback((draftIdx: number) => {
    setDrafts(prev => {
      const next = [...prev];
      const d = next[draftIdx];
      const items = d.edited.items.filter(it => it.item_code && it.qty > 0);
      if (items.length === 0) {
        toast('Adicione ao menos um item com SKU e quantidade > 0.', 'error');
        return prev;
      }
      if (!d.edited.nome?.trim()) {
        toast('Informe o nome do cliente antes de aprovar.', 'error');
        return prev;
      }
      if (!d.edited.origem) {
        toast('Selecione a origem do lead antes de aprovar.', 'error');
        return prev;
      }
      if (!isValidLeadSource(d.edited.origem)) {
        toast('Origem selecionada não é válida.', 'error');
        return prev;
      }
      if (d.edited.cnpj && !isValidCnpj(d.edited.cnpj)) {
        toast('CNPJ informado é inválido. Corrija ou deixe em branco.', 'error');
        return prev;
      }
      next[draftIdx] = { ...d, approved: true };
      return next;
    });
  }, [toast]);

  const discardDraft = useCallback((draftIdx: number) => {
    setDrafts(prev => {
      const next = [...prev];
      next[draftIdx] = { ...next[draftIdx], discarded: true };
      return next;
    });
  }, []);

  // ── Reorder items via drag ──
  const reorderItems = useCallback((draftIdx: number, fromIdx: number, toIdx: number) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = [...next[draftIdx].edited.items];
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

  // ── Product search (review phase SKU autocomplete) ──
  const searchProducts = useCallback(async (draftIdx: number, term: string) => {
    if (!term || term.length < 2) {
      setProductSearch(prev => ({ ...prev, [draftIdx]: { term, results: [], loading: false, open: false } }));
      return;
    }
    setProductSearch(prev => ({
      ...prev,
      [draftIdx]: { ...prev[draftIdx], term, loading: true, open: true },
    }));
    try {
      const data = await cachedSearchProducts(term, 6);
      setProductSearch(prev => ({ ...prev, [draftIdx]: { term, results: data, loading: false, open: true } }));
    } catch {
      setProductSearch(prev => ({
        ...prev,
        [draftIdx]: { term, results: [], loading: false, open: true },
      }));
    }
  }, []);

  const onProductSearchChange = useCallback(
    (draftIdx: number, val: string) => {
      setProductSearch(prev => ({ ...prev, [draftIdx]: { ...prev[draftIdx], term: val, open: true } }));
      if (productTimer.current) clearTimeout(productTimer.current);
      productTimer.current = setTimeout(() => searchProducts(draftIdx, val), 300);
    },
    [searchProducts],
  );

  const selectProduct = useCallback(
    async (draftIdx: number, itemIdx: number, product: Product) => {
      if (isUnpricedProduct(product)) return;
      const current = draftsRef.current.find((draft) => draft.index === draftIdx);
      if (!current || !current.edited.items[itemIdx]) return;
      const updated: Draft = {
        ...current,
        edited: {
          ...current.edited,
          items: current.edited.items.map((item, index) => (
            index === itemIdx
              ? { ...item, item_code: product.sku, item_name: product.nome || '', _rateManual: undefined }
              : item
          )),
        },
      };
      const requestVersion = nextPricingVersion(draftIdx);
      setDrafts(prev => prev.map((draft) => (
        draft.index === draftIdx ? updated : draft
      )));
      setProductSearch(prev => ({
        ...prev,
        [draftIdx]: { term: product.sku, results: [], loading: false, open: false },
      }));
      const priced = await fetchPricing([updated], updated.edited.urgente);
      applyPricingResult(draftIdx, updated, priced[0], requestVersion);
    },
    [applyPricingResult, fetchPricing, nextPricingVersion],
  );

  const closeProductSearch = useCallback((draftIdx: number) => {
    setProductSearch(prev => ({ ...prev, [draftIdx]: { ...prev[draftIdx], open: false } }));
  }, []);

  // ── Refetch pricing for a single draft (e.g. after qty change) ──
  const refetchDraftPricing = useCallback(
    async (draftIdx: number): Promise<Draft | undefined> => {
      const current = draftsRef.current.find((draft) => draft.index === draftIdx);
      if (!current) return undefined;
      const requestVersion = nextPricingVersion(draftIdx);
      const requested = { ...current, edited: { ...current.edited, items: current.edited.items.map((item) => ({ ...item })) } };
      const priced = await fetchPricing([requested], requested.edited.urgente);
      applyPricingResult(draftIdx, requested, priced[0], requestVersion);
      return priced[0];
    },
    [applyPricingResult, fetchPricing, nextPricingVersion],
  );

  // ── Helper: build draft objects from extracted orders ──
  const buildDraftsFromOrders = useCallback(
    (orders: Record<string, unknown>[], prazoVal: string, templateKey = ''): Draft[] => {
      return orders.map((order, i) => ({
        index: i,
        original: { ...order },
        edited: {
          nome: String(order.nome || ''),
          email: String(order.email || ''),
          telefone: String(order.telefone || ''),
          urgente: Boolean(order.urgente || false),
          origem: normalizeLeadSource(order.origem) || '',
          cnpj: normalizeCnpj(order.cnpj || ''),
          endereco: normalizeAddress(order.endereco),
          items: (Array.isArray(order.items) ? order.items : []).map((it: unknown) => ({
            item_code: String((it as Record<string, unknown>).item_code || ''),
            qty: Number((it as Record<string, unknown>).qty || 0),
            rate: (it as Record<string, unknown>).rate != null ? Number((it as Record<string, unknown>).rate) : null,
          })),
          prazo_producao: prazoVal || String(order.prazo_producao || order.prazo || ''),
          pagamento: typeof order.pagamento === 'string' ? order.pagamento : undefined,
          entrega: typeof order.entrega === 'string' ? order.entrega : undefined,
          observacoes: typeof order.observacoes === 'string' ? order.observacoes : undefined,
          frete: order.frete == null ? undefined : String(order.frete),
          template_key: templateKey || (typeof order.template_key === 'string' ? order.template_key : undefined),
        },
        approved: false,
        discarded: false,
      }));
    },
    [],
  );

  return {
    // State
    drafts,
    setDrafts,
    productSearch,
    setProductSearch,
    productTimer,
    // Pricing
    fetchPricing,
    refetchDraftPricing,
    // Item mutations
    updateDraftItem,
    addDraftItem,
    removeDraftItem,
    reorderItems,
    // Field mutations
    updateDraftField,
    updateDraftAddressField,
    handleUrgenteToggle,
    // Approval
    approveDraft,
    discardDraft,
    // Product search
    onProductSearchChange,
    closeProductSearch,
    selectProduct,
    // Helpers
    buildDraftsFromOrders,
  };
}

// src/hooks/useExtractionDrafts.ts
// Encapsulates draft state management: drafts array, pricing, mutations, product search.
// Extracted from AutoQuotePage.jsx.

import { useState, useCallback, useRef } from 'react';
import { apiPost } from '@/lib/api';
import { searchProducts as cachedSearchProducts } from '@/lib/productCache';
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

export function useExtractionDrafts() {
  // ── State ──
  const [drafts, setDrafts] = useState<Draft[]>([]);
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
        if (!next[di].edited.items[ii]._rateManual) {
          next[di].edited.items[ii].rate = res.items[i].rate;
          next[di].edited.items[ii].item_name =
            res.items[i].item_name || next[di].edited.items[ii].item_name;
        }
      }
      return next;
    } catch (err) {
      console.warn('[pricing]', (err as Error).message);
      return draftsList;
    }
  }, []);

  // ── Draft item mutations ──
  const updateDraftItem = useCallback(
    (draftIdx: number, itemIdx: number, field: keyof DraftItem, value: unknown) => {
      setDrafts(prev => {
        const next = [...prev];
        const items = [...next[draftIdx].edited.items];
        items[itemIdx] = { ...items[itemIdx], [field]: value } as DraftItem;
        if (field === 'rate') items[itemIdx]._rateManual = true;
        if (field === 'item_code') delete items[itemIdx]._rateManual;
        if (field === 'qty') delete items[itemIdx]._rateManual;
        next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
        return next;
      });
    },
    [],
  );

  const addDraftItem = useCallback((draftIdx: number) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = [
        ...next[draftIdx].edited.items,
        { item_code: '', qty: 30, rate: null, _rateManual: true } as DraftItem,
      ];
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

  const removeDraftItem = useCallback((draftIdx: number, itemIdx: number) => {
    setDrafts(prev => {
      const next = [...prev];
      const items = next[draftIdx].edited.items.filter((_, i) => i !== itemIdx);
      next[draftIdx] = { ...next[draftIdx], edited: { ...next[draftIdx].edited, items } };
      return next;
    });
  }, []);

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
      setDrafts(prev => {
        const next = [...prev];
        next[draftIdx] = {
          ...next[draftIdx],
          edited: { ...next[draftIdx].edited, urgente: checked },
        };
        return next;
      });

      const current = await new Promise<Draft | undefined>(resolve => {
        setDrafts(prev => {
          resolve(prev.find(d => d.index === draftIdx));
          return prev;
        });
      });
      if (current) {
        const updated = { ...current, edited: { ...current.edited, urgente: checked } };
        const priced = await fetchPricing([updated], checked);
        setDrafts(prev => {
          const next = [...prev];
          next[draftIdx] = priced[0];
          return next;
        });
      }
    },
    [fetchPricing],
  );

  // ── Draft approval / discard ──
  const approveDraft = useCallback((draftIdx: number) => {
    setDrafts(prev => {
      const next = [...prev];
      const d = next[draftIdx];
      const items = d.edited.items.filter(it => it.item_code && it.qty > 0);
      if (items.length === 0) {
        alert('Adicione ao menos um item com SKU e quantidade > 0.');
        return prev;
      }
      if (!d.edited.nome?.trim()) {
        alert('Informe o nome do cliente antes de aprovar.');
        return prev;
      }
      if (!d.edited.origem) {
        alert('Selecione a origem do lead antes de aprovar.');
        return prev;
      }
      if (!isValidLeadSource(d.edited.origem)) {
        alert('Origem selecionada não é válida.');
        return prev;
      }
      if (d.edited.cnpj && !isValidCnpj(d.edited.cnpj)) {
        alert('CNPJ informado é inválido. Corrija ou deixe em branco.');
        return prev;
      }
      next[draftIdx] = { ...d, approved: true };
      return next;
    });
  }, []);

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
      updateDraftItem(draftIdx, itemIdx, 'item_code', product.sku);
      updateDraftItem(draftIdx, itemIdx, 'item_name', product.nome || '');
      setProductSearch(prev => ({
        ...prev,
        [draftIdx]: { term: product.sku, results: [], loading: false, open: false },
      }));
      let draft: Draft | undefined;
      setDrafts(prev => {
        draft = prev.find(d => d.index === draftIdx);
        return prev;
      });
      await new Promise(r => setTimeout(r, 0));
      if (draft) {
        const priced = await fetchPricing([draft], draft.edited.urgente);
        setDrafts(prev => {
          const next = [...prev];
          next[draftIdx] = priced[0];
          return next;
        });
      }
    },
    [fetchPricing, updateDraftItem],
  );

  const closeProductSearch = useCallback((draftIdx: number) => {
    setProductSearch(prev => ({ ...prev, [draftIdx]: { ...prev[draftIdx], open: false } }));
  }, []);

  // ── Refetch pricing for a single draft (e.g. after qty change) ──
  const refetchDraftPricing = useCallback(
    async (draftIdx: number) => {
      const current = await new Promise<Draft | undefined>(resolve => {
        setDrafts(prev => {
          resolve(prev.find(d => d.index === draftIdx));
          return prev;
        });
      });
      if (!current) return;
      const priced = await fetchPricing([{ ...current }], current.edited.urgente);
      setDrafts(prev => {
        const idx = prev.findIndex(d => d.index === draftIdx);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = priced[0];
        return next;
      });
    },
    [fetchPricing],
  );

  // ── Helper: build draft objects from extracted orders ──
  const buildDraftsFromOrders = useCallback(
    (orders: Record<string, unknown>[], prazoVal: string): Draft[] => {
      return orders.map((order, i) => ({
        index: i,
        original: { ...order },
        edited: {
          nome: String(order.nome || ''),
          email: String(order.email || ''),
          telefone: String(order.telefone || ''),
          urgente: Boolean(order.urgente || false),
          origem: normalizeLeadSource(order.origem) || 'Google Ads',
          cnpj: normalizeCnpj(order.cnpj || ''),
          endereco: normalizeAddress(order.endereco),
          items: (Array.isArray(order.items) ? order.items : []).map((it: unknown) => ({
            item_code: String((it as Record<string, unknown>).item_code || ''),
            qty: Number((it as Record<string, unknown>).qty || 0),
            rate: (it as Record<string, unknown>).rate != null ? Number((it as Record<string, unknown>).rate) : null,
          })),
          prazo_producao: prazoVal || '',
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

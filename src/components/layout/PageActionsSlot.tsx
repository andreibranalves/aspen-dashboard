import { createContext, useContext, type ReactNode } from 'react';

/**
 * Onde o PageHeader renderiza as ações da página: o slot da TopBar.
 * `undefined` fora do Layout (ações ficam no próprio cabeçalho); `null` enquanto a TopBar monta.
 */
const PageActionsSlotContext = createContext<HTMLElement | null | undefined>(undefined);

export function PageActionsSlotProvider({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  return <PageActionsSlotContext.Provider value={slot}>{children}</PageActionsSlotContext.Provider>;
}

export function usePageActionsSlot(): HTMLElement | null | undefined {
  return useContext(PageActionsSlotContext);
}

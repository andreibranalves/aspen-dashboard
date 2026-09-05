import { createContext, useContext, useEffect, type ReactNode } from 'react';

type SetBreadcrumbLabel = (label: string | null) => void;

const BreadcrumbLabelContext = createContext<SetBreadcrumbLabel>(() => undefined);

export function BreadcrumbLabelProvider({
  children,
  setLabel,
}: {
  children: ReactNode;
  setLabel: SetBreadcrumbLabel;
}) {
  return (
    <BreadcrumbLabelContext.Provider value={setLabel}>{children}</BreadcrumbLabelContext.Provider>
  );
}

export function useBreadcrumbLabel(label: string | null) {
  const setLabel = useContext(BreadcrumbLabelContext);

  useEffect(() => {
    setLabel(label?.trim() || null);
    return () => setLabel(null);
  }, [label, setLabel]);
}

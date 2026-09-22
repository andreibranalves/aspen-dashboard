import { useRef, type KeyboardEvent } from 'react';
import { BriefcaseBusiness, ListChecks, PlusCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import CommercialQueuePanel from '@/features/commercial/components/CommercialQueuePanel';
import CrmKanbanPage from '@/features/crm/pages/CrmKanbanPage';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';

type CommercialTab = 'deals' | 'queue';
const parseCommercialTab = parseHashOption<CommercialTab>(['deals', 'queue']);

const TABS: Array<{ key: CommercialTab; label: string; icon: typeof BriefcaseBusiness }> = [
  { key: 'queue', label: 'Fila', icon: ListChecks },
  { key: 'deals', label: 'Negócios', icon: BriefcaseBusiness },
];

interface CommercialPageProps {
  navigate: (hash: string) => void;
}

export default function CommercialPage({ navigate }: CommercialPageProps) {
  const [tab, setTab] = useHashQueryState<CommercialTab>('tab', 'queue', parseCommercialTab);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function changeTab(nextTab: CommercialTab) {
    setTab(nextTab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    changeTab(TABS[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Comercial"
        description="Cada oportunidade com um próximo passo."
        actions={
          <>
            <div className="mr-auto inline-flex max-w-full gap-1" role="tablist" aria-label="Área comercial">
              {TABS.map((item, index) => (
                <button
                  key={item.key}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  type="button"
                  role="tab"
                  id={`commercial-tab-${item.key}`}
                  aria-controls="commercial-panel"
                  aria-selected={tab === item.key}
                  tabIndex={tab === item.key ? 0 : -1}
                  className={tab === item.key ? 'rounded-control bg-shell px-3 py-2 text-xs font-semibold text-shell-text' : 'rounded-control px-3 py-2 text-xs text-fg-muted hover:text-fg'}
                  onClick={() => changeTab(item.key)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >{item.label}</button>
              ))}
            </div>
            <Button type="button" onClick={() => navigate('/manual')}>
              <PlusCircle aria-hidden="true" />Novo orçamento
            </Button>
          </>
        }
      />

      <div
        id="commercial-panel"
        role="tabpanel"
        aria-labelledby={`commercial-tab-${tab}`}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {tab === 'deals' && <CrmKanbanPage embedded />}
        {tab === 'queue' && <CommercialQueuePanel navigate={navigate} />}
      </div>
    </PageShell>
  );
}

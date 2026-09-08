import { useRef, type KeyboardEvent } from 'react';
import { BriefcaseBusiness, MessageSquare, PlusCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { Button } from '@/components/ui/button';
import CrmKanbanPage from '@/features/crm/pages/CrmKanbanPage';
import FollowUpsPage, { type FollowUpReturnView } from '@/features/follow-ups/pages/FollowUpsPage';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';

type CommercialTab = 'deals' | 'returns';
const parseCommercialTab = parseHashOption<CommercialTab>(['deals', 'returns']);
const parseReturnView = parseHashOption<FollowUpReturnView>(['unanswered', 'sent']);

const TABS: Array<{ key: CommercialTab; label: string; icon: typeof BriefcaseBusiness }> = [
  { key: 'deals', label: 'Negócios', icon: BriefcaseBusiness },
  { key: 'returns', label: 'Retornos', icon: MessageSquare },
];
const RETURN_TABS: Array<{ key: FollowUpReturnView; label: string }> = [
  { key: 'unanswered', label: 'Sem resposta' },
  { key: 'sent', label: 'Após envio' },
];

interface CommercialPageProps {
  navigate: (hash: string) => void;
}

export default function CommercialPage({ navigate }: CommercialPageProps) {
  const [tab, setTab] = useHashQueryState<CommercialTab>('tab', 'deals', parseCommercialTab);
  const [returnView, setReturnView] = useHashQueryState<FollowUpReturnView>(
    'return',
    'unanswered',
    parseReturnView
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  function handleReturnTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % RETURN_TABS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + RETURN_TABS.length) % RETURN_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = RETURN_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setReturnView(RETURN_TABS[nextIndex].key);
    returnTabRefs.current[nextIndex]?.focus();
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Comercial"
        actions={
          <Button type="button" onClick={() => navigate('/manual')}>
            <PlusCircle aria-hidden="true" />
            Novo orçamento
          </Button>
        }
      />

      <div className="border-b border-line" role="tablist" aria-label="Área comercial">
        <div className="flex gap-1">
          {TABS.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`commercial-tab-${item.key}`}
                aria-controls="commercial-panel"
                aria-selected={tab === item.key}
                tabIndex={tab === item.key ? 0 : -1}
                className={
                  tab === item.key
                    ? 'inline-flex items-center gap-2 border-b-2 border-primary px-3 py-3 text-sm font-semibold text-primary'
                    : 'inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm text-fg-muted hover:text-fg'
                }
                onClick={() => changeTab(item.key)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <Icon aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'returns' && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Tipo de retorno">
          {RETURN_TABS.map((item, index) => (
            <button
              key={item.key}
              ref={(element) => {
                returnTabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`commercial-return-tab-${item.key}`}
              aria-controls="commercial-panel"
              aria-selected={returnView === item.key}
              tabIndex={returnView === item.key ? 0 : -1}
              className={
                returnView === item.key
                  ? 'rounded-sm bg-surface-muted px-3 py-2 text-sm font-medium text-fg'
                  : 'rounded-sm px-3 py-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg'
              }
              onClick={() => setReturnView(item.key)}
              onKeyDown={(event) => handleReturnTabKeyDown(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div
        id="commercial-panel"
        role="tabpanel"
        aria-labelledby={`commercial-tab-${tab}`}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {tab === 'deals' ? (
          <CrmKanbanPage embedded />
        ) : (
          <FollowUpsPage navigate={navigate} embedded returnView={returnView} />
        )}
      </div>
    </PageShell>
  );
}

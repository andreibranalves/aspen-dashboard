import { BriefcaseBusiness, ListChecks } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import CommercialQueuePanel from '@/features/commercial/components/CommercialQueuePanel';
import CrmKanbanPage from '@/features/crm/pages/CrmKanbanPage';
import { parseHashOption, useHashQueryState } from '@/hooks/useHashQueryState';

type CommercialTab = 'deals' | 'queue';
const parseCommercialTab = parseHashOption<CommercialTab>(['deals', 'queue']);

const TABS = [
  { value: 'queue', label: 'Fila', icon: ListChecks },
  { value: 'deals', label: 'Negócios', icon: BriefcaseBusiness },
] as const;

interface CommercialPageProps {
  navigate: (hash: string) => void;
}

export default function CommercialPage({ navigate }: CommercialPageProps) {
  const [tab, setTab] = useHashQueryState<CommercialTab>('tab', 'queue', parseCommercialTab);

  return (
    <PageShell className="space-y-5">
      <PageHeader title="Comercial" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabList label="Área comercial" items={TABS} />
        <TabPanel value="queue">
          <CommercialQueuePanel navigate={navigate} />
        </TabPanel>
        <TabPanel value="deals">
          <CrmKanbanPage embedded />
        </TabPanel>
      </Tabs>
    </PageShell>
  );
}

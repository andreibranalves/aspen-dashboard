// Escolha do fluxo de WhatsApp no envio de um orçamento emitido.

import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import InlineAlert from '@/components/shared/InlineAlert';
import type { CommunicationFlow } from '@/lib/api/communicationApi';
import {
  communicationFlowSummary,
  isQuotationDeliveryFlow,
  renderableFlowStepCount,
} from '@/lib/api/communicationApi';

export interface WhatsAppSendPanelProps {
  selectedFlowId?: string;
  flows?: CommunicationFlow[];
  onSelectFlow?: (flowId: string) => void;
  disabled?: boolean;
}

// Fluxo só com o PDF resume em "PDF"; a frase completa equilibra o card com os fluxos descritos.
function flowDescription(flow: CommunicationFlow): string {
  if (flow.description) return flow.description;
  const summary = communicationFlowSummary(flow);
  return summary === 'PDF' ? 'Envia só o PDF do orçamento, sem mensagem.' : summary;
}

export default function WhatsAppSendPanel({
  selectedFlowId,
  flows = [],
  onSelectFlow,
  disabled = false,
}: WhatsAppSendPanelProps) {
  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) || flows[0] || null;
  const hasValidSteps = isQuotationDeliveryFlow(selectedFlow) && renderableFlowStepCount(selectedFlow) > 0;

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled || flows.length === 0}>
      <legend className="mb-2 text-sm font-semibold text-fg">Fluxo WhatsApp</legend>
      {flows.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:auto-cols-fr md:grid-flow-col md:grid-cols-none">
          {flows.map((flow) => {
            const checked = flow.id === selectedFlow?.id;
            return (
              <label
                key={flow.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors',
                  checked ? 'border-primary/40 bg-primary/5' : 'border-line hover:bg-surface-hover'
                )}
              >
                <input
                  type="radio"
                  name="whatsapp-flow"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={checked}
                  onChange={() => onSelectFlow?.(flow.id)}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-fg">{flow.name}</span>
                  <Text as="span" variant="meta">{flowDescription(flow)}</Text>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {!hasValidSteps && (
        <InlineAlert tone="warning">
          {!selectedFlow
            ? 'Nenhum fluxo de WhatsApp disponível.'
            : 'Este fluxo precisa estar ativo e conter exatamente um PDF ou WebP do orçamento.'}
        </InlineAlert>
      )}
    </fieldset>
  );
}

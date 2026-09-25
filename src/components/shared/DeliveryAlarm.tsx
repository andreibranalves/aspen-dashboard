import InlineAlert from '@/components/shared/InlineAlert';
import type { DeliveryDiagnostics } from '@/lib/api/whatsappDeliveryDiagnosticsApi';
import { deliveryAlarm } from '@/lib/deliveryAlarm';

/**
 * Envios and Canais: raised when the async WhatsApp work stopped (ADR 0013).
 * An unreadable diagnostic is raised too, so silence always means healthy.
 */
export default function DeliveryAlarm({
  diagnostics,
  failed = false,
}: {
  diagnostics: DeliveryDiagnostics | null;
  failed?: boolean;
}) {
  if (failed) {
    return <InlineAlert tone="warning" title="Não foi possível verificar os envios automáticos" />;
  }
  const alarm = diagnostics ? deliveryAlarm(diagnostics) : null;
  if (!alarm) return null;
  return (
    <InlineAlert tone="warning" title={alarm.title}>
      {alarm.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </InlineAlert>
  );
}

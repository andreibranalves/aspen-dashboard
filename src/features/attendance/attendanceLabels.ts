import type { AttendanceMessage, AttendanceMessageType } from '@/lib/api/attendanceApi';

export const MESSAGE_TYPE_LABELS: Record<Exclude<AttendanceMessageType, 'text'>, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
  location: 'Localização',
  contact: 'Contato',
  unsupported: 'Tipo de mensagem não suportado',
};

const FAILURE_LABELS: Record<string, string> = {
  DESTINATION_CHANGED: 'Não enviada: o destinatário mudou.',
  EXTERNAL_WRITES_DISABLED: 'Não enviada: envio desativado neste ambiente.',
  SEND_WINDOW_EXPIRED: 'Não enviada: passou de 30 min na fila.',
};

/** Sending state shown under an outbound bubble; never promises delivery. */
export function deliveryLabel(message: AttendanceMessage): string | null {
  if (message.direction !== 'outbound') return null;
  const receipt =
    message.deliveryStatus === 'read' ? 'Lida' : message.deliveryStatus === 'delivered' ? 'Entregue' : null;
  switch (message.outboxState) {
    case 'queued':
    case 'dispatching':
      return 'Enviando…';
    case 'retry_scheduled':
      return 'Nova tentativa agendada';
    case 'failed':
      if (message.resolution === 'confirmed_not_sent') return 'Não enviada (confirmado por você)';
      return (message.failureCode && FAILURE_LABELS[message.failureCode]) || 'Não enviada';
    case 'needs_review':
      return 'Envio não confirmado: confira no WhatsApp';
    case 'cancelled':
      return 'Cancelada';
    case 'provider_accepted':
      // An operator finding is not a provider fact.
      if (message.resolution === 'confirmed_sent') return receipt || 'Enviada (confirmado por você)';
      return receipt || 'Aceita pelo WhatsApp';
    default:
      return receipt;
  }
}

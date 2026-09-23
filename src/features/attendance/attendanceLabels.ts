import type {
  AttendanceMessage,
  AttendanceMessageType,
  AttendanceStatus,
  AttendanceStatusFilter,
} from '@/lib/api/attendanceApi';

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  open: 'Aberta',
  waiting_customer: 'Aguardando cliente',
  closed: 'Encerrada',
  ignored: 'Ignorada',
};

export const STATUS_FILTERS: Array<{ value: AttendanceStatusFilter; label: string }> = [
  { value: 'active', label: 'Todas' },
  { value: 'open', label: 'Abertas' },
  { value: 'waiting_customer', label: 'Aguardando cliente' },
  { value: 'closed', label: 'Encerradas' },
  { value: 'ignored', label: 'Ignoradas' },
];

/** StatusBadge key or tone class per attendance status. */
export const STATUS_BADGE: Record<AttendanceStatus, { status: string; className?: string }> = {
  open: { status: 'Open' },
  waiting_customer: { status: 'waiting_customer', className: 'tone-warning-soft' },
  closed: { status: 'Closed' },
  ignored: { status: 'ignored', className: 'tone-neutral-soft' },
};

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

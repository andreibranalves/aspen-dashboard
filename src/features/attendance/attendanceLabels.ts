import type { AttendanceMessageType, AttendanceStatus, AttendanceStatusFilter } from '@/lib/api/attendanceApi';

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

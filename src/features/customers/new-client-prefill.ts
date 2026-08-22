export interface NewClientPrefill {
  nome: string;
  telefone: string;
}

function safeQueryText(value: string | null, maxLength: number): string {
  if (!value) return '';
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  })) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function readNewClientPrefill(hash: string): NewClientPrefill {
  const route = String(hash || '').replace(/^#/, '').split('?')[0];
  if (route !== '/leads/cliente/new') return { nome: '', telefone: '' };

  const query = String(hash || '').split('?')[1] || '';
  const params = new URLSearchParams(query);
  const nome = safeQueryText(params.get('nome'), 200);
  const rawPhone = safeQueryText(params.get('telefone'), 32);
  const telefone = /^[0-9]{10,15}$/.test(rawPhone) ? rawPhone : '';
  return { nome, telefone };
}

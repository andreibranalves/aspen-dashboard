// Contexto para pré-preencher um orçamento no painel Auto (#/auto).
const QUOTE_PREFILL_KEY = 'aspen_quote_prefill';

export function createQuoteForClient(
  client: { display_name?: string | null; nome?: string | null; email?: string | null; telefone?: string | null },
  navigate?: (path: string) => void,
): void {
  const prefill: Record<string, string> = {};
  const nome = client.display_name || client.nome;
  if (nome) prefill.nome = nome;
  if (client.email) prefill.email = client.email;
  if (client.telefone) prefill.telefone = client.telefone;
  try {
    window.sessionStorage.setItem(QUOTE_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* sessionStorage indisponível */
  }
  navigate?.('/auto');
}

import { useEffect } from 'react';

/**
 * #254: the quotation follow-up queue is no longer an operational entry.
 * Keep the old hash reachable for bookmarks, but land on Comercial/Fila.
 */
export default function LegacyFollowUpsRedirect({
  navigate,
}: {
  navigate: (hash: string) => void;
}) {
  useEffect(() => {
    navigate('/crm');
  }, [navigate]);

  return (
    <p className="p-6 text-sm text-fg-muted" role="status">
      A fila operacional agora fica em Comercial. Redirecionando…
    </p>
  );
}

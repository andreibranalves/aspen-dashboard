import { useEffect } from 'react';
import PageLoader from '@/components/shared/PageLoader';

/** Replaces the current history entry, so Back never returns to a retired route. */
export default function RouteRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(`#${to}`);
  }, [to]);
  return <PageLoader />;
}

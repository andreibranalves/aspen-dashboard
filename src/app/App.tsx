import { Suspense, type ReactNode } from 'react';
import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';
import PageLoader from '@/components/shared/PageLoader';
import { routes, type AppRoute } from '@/app/routes';
import AutoQuotePage from '@/features/quotations/pages/AutoQuotePage';

function findRoute(route: string): { entry: AppRoute; params: Record<string, string> } | null {
  for (const entry of routes) {
    const params = entry.match ? entry.match(route) : route === entry.path ? {} : null;
    if (params) return { entry, params };
  }
  return null;
}

export default function App() {
  const [route, navigate] = useHashRoute();
  const matched = findRoute(route);

  let content: ReactNode;
  if (matched) {
    content = matched.entry.render({ navigate, params: matched.params });
    if (matched.entry.suspense) {
      content = <Suspense fallback={<PageLoader />}>{content}</Suspense>;
    }
  } else {
    content = <AutoQuotePage />;
  }

  if (matched && matched.entry.layout === false) return content;
  return (
    <Layout route={route} onNavigate={navigate}>
      {content}
    </Layout>
  );
}

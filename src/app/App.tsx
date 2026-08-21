import { Suspense, type ReactNode } from 'react';
import { useHashRoute, RouteGuardProvider } from '@/hooks/useHashRoute';
import { ToastProvider } from '@/components/shared/toast';
import Layout from '@/components/layout/Layout';
import PageLoader from '@/components/shared/PageLoader';
import { routes, type AppRoute } from '@/app/routes';
import { routePath } from '@/app/match-route';
import NotFoundPage from '@/components/shared/NotFoundPage';

function findRoute(route: string): { entry: AppRoute; params: Record<string, string> } | null {
  const path = routePath(route);
  for (const entry of routes) {
    const params = entry.match ? entry.match(path) : path === entry.path ? {} : null;
    if (params) return { entry, params };
  }
  return null;
}

export default function App() {
  const [route, navigate, setNavigationGuard] = useHashRoute();
  const matched = findRoute(route);

  let content: ReactNode;
  if (matched) {
    content = matched.entry.render({
      navigate,
      params: matched.params,
      setNavigationGuard,
    });
    if (matched.entry.suspense) {
      content = <Suspense fallback={<PageLoader />}>{content}</Suspense>;
    }
  } else {
    content = <NotFoundPage navigate={navigate} />;
  }

  if (matched && matched.entry.layout === false) {
    return (
      <ToastProvider>
        <RouteGuardProvider setNavigationGuard={setNavigationGuard}>
          {content}
        </RouteGuardProvider>
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <RouteGuardProvider setNavigationGuard={setNavigationGuard}>
        <Layout route={route} onNavigate={navigate}>
          {content}
        </Layout>
      </RouteGuardProvider>
    </ToastProvider>
  );
}

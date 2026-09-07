import PageShell from '@/components/shared/PageShell';

export default function PageLoader() {
  return (
    <PageShell className="flex h-[50vh] items-center justify-center space-y-0 text-fg-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-primary" />
    </PageShell>
  );
}

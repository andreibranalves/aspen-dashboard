import { useEffect } from 'react';
import { useToast } from '@/components/shared/toast';
import { WORKER_WAKE_FAILED_EVENT, WORKER_WAKE_FAILED_MESSAGE } from '@/lib/workerWake';

export function WorkerWakeNotice() {
  const { toast } = useToast();
  useEffect(() => {
    const show = () => toast(WORKER_WAKE_FAILED_MESSAGE, 'error');
    window.addEventListener(WORKER_WAKE_FAILED_EVENT, show);
    return () => window.removeEventListener(WORKER_WAKE_FAILED_EVENT, show);
  }, [toast]);
  return null;
}

import { useState, type ReactNode } from 'react';
import { Download, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/shared/toast';
import {
  downloadCommercialExport,
  type CommercialExportFilters,
  type CommercialExportResource,
} from '@/lib/api/commercialExports';

interface ExportCsvButtonProps {
  resource: CommercialExportResource;
  filters: CommercialExportFilters;
  children: ReactNode;
}

export default function ExportCsvButton({
  resource,
  filters,
  children,
}: ExportCsvButtonProps) {
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCommercialExport(resource, filters);
      toast('Exportação iniciada.', 'success');
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Não foi possível gerar a exportação. Tente novamente.',
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void exportCsv()}
      disabled={exporting}
      aria-busy={exporting}
    >
      {exporting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      {exporting ? 'Exportando…' : children}
    </Button>
  );
}

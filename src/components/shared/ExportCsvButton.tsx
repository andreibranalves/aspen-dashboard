import { useState, type ReactNode } from 'react';
import { Download, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/shared/toast';
import {
  commercialExportOperatorMessage,
  downloadCommercialExport,
  type CommercialExportFilters,
  type CommercialExportResource,
} from '@/lib/api/commercialExports';

interface ExportCsvButtonProps {
  resource: CommercialExportResource;
  filters: CommercialExportFilters;
  children: ReactNode;
  className?: string;
}

export default function ExportCsvButton({
  resource,
  filters,
  children,
  className,
}: ExportCsvButtonProps) {
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCommercialExport(resource, filters);
      toast('Exportação iniciada.', 'success');
    } catch (error) {
      toast(commercialExportOperatorMessage(error), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => void exportCsv()}
      disabled={exporting}
      aria-busy={exporting}
    >
      {exporting ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : (
        <Download aria-hidden="true" />
      )}
      {exporting ? 'Exportando…' : children}
    </Button>
  );
}

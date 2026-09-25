import { Button } from '@/components/ui/button';

interface StickySaveBarProps {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
}

/**
 * StickySaveBar — aparece no fim de formulários longos enquanto há alteração
 * não salva e acompanha a rolagem, para salvar sem voltar ao topo.
 */
export default function StickySaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  saveLabel = 'Salvar',
}: StickySaveBarProps) {
  if (!dirty && !saving) return null;
  return (
    <div
      role="region"
      aria-label="Alterações não salvas"
      className="sticky bottom-(--mobile-nav-h) z-floating flex items-center justify-between gap-3 rounded-card border border-line bg-surface/95 px-4 py-3 shadow-bar backdrop-blur lg:bottom-4"
    >
      <span className="text-sm text-fg-muted">Alterações não salvas</span>
      <div className="flex items-center gap-2">
        {onDiscard && (
          <Button variant="ghost" size="md" onClick={onDiscard} disabled={saving}>
            Descartar
          </Button>
        )}
        <Button size="md" onClick={onSave} disabled={saving}>
          {saving ? 'Salvando…' : saveLabel}
        </Button>
      </div>
    </div>
  );
}

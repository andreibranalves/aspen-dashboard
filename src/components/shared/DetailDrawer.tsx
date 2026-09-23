import type { ReactNode } from 'react';
import { Drawer } from '@/components/ui/dialog';

export interface DetailDrawerProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** DetailDrawer — painel lateral para drill-down operacional, sobre o Drawer compartilhado. */
export function DetailDrawer({ open, onClose, title, description, actions, children, className }: DetailDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={() => onClose?.()}
      title={title || 'Detalhes'}
      description={description}
      actions={actions}
      className={className}
    >
      {children}
    </Drawer>
  );
}

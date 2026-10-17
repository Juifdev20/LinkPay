import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ShortcutButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

/** Solid action button — deliberately unlike the stat tiles so a shortcut is never mistaken for a card. */
export function ShortcutButton({ icon: Icon, label, onClick }: ShortcutButtonProps) {
  return (
    <Button onClick={onClick} className="w-full min-w-0 gap-2">
      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

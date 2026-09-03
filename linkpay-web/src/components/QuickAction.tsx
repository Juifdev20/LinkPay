import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface QuickActionProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  className?: string;
}

export function QuickAction({ icon: Icon, label, onClick, className }: QuickActionProps) {
  return (
    <button
      onClick={onClick}
      className={cn('flex flex-col items-center gap-2 group', className)}
    >
      <div className="w-14 h-14 rounded-2xl bg-card border border-border shadow-card flex items-center justify-center transition-all group-hover:shadow-card-hover group-hover:border-primary/30 group-active:scale-95">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </button>
  );
}

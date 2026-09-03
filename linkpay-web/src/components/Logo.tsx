import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { box: 'w-8 h-8', text: 'text-sm', icon: 'text-xs', gap: 'gap-2', title: 'text-base' },
  md: { box: 'w-10 h-10', text: 'text-base', icon: 'text-sm', gap: 'gap-2.5', title: 'text-lg' },
  lg: { box: 'w-12 h-12', text: 'text-lg', icon: 'text-base', gap: 'gap-3', title: 'text-xl' },
  xl: { box: 'w-16 h-16', text: 'text-2xl', icon: 'text-2xl', gap: 'gap-4', title: 'text-2xl' },
};

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const s = sizeMap[size];
  return (
    <div className={cn('flex items-center', s.gap, className)}>
      <div
        className={cn(
          'rounded-xl bg-primary flex items-center justify-center font-extrabold text-primary-foreground shadow-sm',
          s.box,
          s.text,
        )}
      >
        LP
      </div>
      {showText && (
        <span className={cn('font-bold tracking-tight text-foreground', s.title)}>
          LinkPay
        </span>
      )}
    </div>
  );
}

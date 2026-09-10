import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'card' | 'text' | 'avatar' | 'button';
}

export function Skeleton({ className, variant = 'default', ...props }: SkeletonProps) {
  const variantStyles = {
    default: 'h-4 w-full',
    card: 'h-24 w-full rounded-xl',
    text: 'h-4 w-3/4',
    avatar: 'h-10 w-10 rounded-full',
    button: 'h-11 w-24 rounded-lg',
  };

  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', variantStyles[variant], className)}
      {...props}
    />
  );
}

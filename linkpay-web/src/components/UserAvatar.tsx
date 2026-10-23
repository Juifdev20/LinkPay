import { cn } from '@/lib/utils';

/**
 * The account's avatar: the same silhouette for everyone (no profile photos for now — product choice, 2026),
 * on the brand gradient.
 */
export function UserAvatar({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#b9a6ff] to-[#7cc8ff] ring-2 ring-card', className)}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <circle cx="20" cy="15.5" r="7" fill="white" fillOpacity="0.95" />
        <path d="M5 40c0-8.8 6.7-14.5 15-14.5S35 31.2 35 40" fill="white" fillOpacity="0.95" />
      </svg>
    </span>
  );
}

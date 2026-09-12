import { cn } from '@/lib/utils';
// Inlined as a base64 data URI at build time (vite.config.ts raises
// assetsInlineLimit so this ~51KB file qualifies) instead of referenced as
// a network path — a real app's icon ships inside the app itself and is
// never something that can fail to load. Bundled once into the shared JS
// (already precached by the service worker for the PWA build), so the logo
// can never show as a broken image anywhere it's used, offline or online,
// even on a cold start before the service worker has cached anything.
import logoSrc from '@/assets/logo.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  /** Override the icon's own size/shape (e.g. for a badge that needs a
   * specific pixel size independent of the sm/md/lg/xl presets below). */
  imgClassName?: string;
}

const sizeMap = {
  sm: { box: 'w-8 h-8', gap: 'gap-2', title: 'text-base' },
  md: { box: 'w-10 h-10', gap: 'gap-2.5', title: 'text-lg' },
  lg: { box: 'w-12 h-12', gap: 'gap-3', title: 'text-xl' },
  xl: { box: 'w-16 h-16', gap: 'gap-4', title: 'text-2xl' },
};

export function Logo({ size = 'md', showText = true, className, imgClassName }: LogoProps) {
  const s = sizeMap[size];
  return (
    <div className={cn('flex items-center', s.gap, className)}>
      <img
        src={logoSrc}
        alt="LinkPay"
        className={cn('rounded-xl object-cover shadow-sm', s.box, imgClassName)}
      />
      {showText && (
        <span className={cn('font-bold tracking-tight text-foreground', s.title)}>
          LinkPay
        </span>
      )}
    </div>
  );
}

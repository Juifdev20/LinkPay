import { Logo } from '@/components/Logo';
import { BrandWave } from './BrandWave';
import { cn } from '@/lib/utils';

interface AuthBrandingPanelProps {
  headline: string;
  tagline?: string;
  className?: string;
}

/**
 * Shared colored panel for the Login/Register pages — a solid brand-color
 * block with a circular logo badge and a soft wave boundary, matching the
 * reference design. Compact strip above the form on mobile (wave along the
 * bottom edge), full-height side panel on desktop (wave along the right
 * edge) — sizing controlled entirely via `className` from each page, so
 * this component stays layout-agnostic.
 */
export function AuthBrandingPanel({ headline, tagline, className }: AuthBrandingPanelProps) {
  return (
    <div className={cn('relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 flex-shrink-0', className)}>
      <div className="absolute -top-1/3 -left-1/4 w-[80%] h-[80%] bg-secondary/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 py-6 text-center gap-3 md:gap-5">
        <div className="w-14 h-14 md:w-20 md:h-20 rounded-full bg-background flex items-center justify-center shadow-lg flex-shrink-0">
          <Logo size="sm" showText={false} imgClassName="w-9 h-9 md:w-12 md:h-12 rounded-lg" />
        </div>
        <h1 className="text-xl md:text-4xl lg:text-5xl font-bold text-primary-foreground leading-tight">
          {headline}
        </h1>
        {tagline && (
          <p className="text-primary-foreground/80 text-xs md:text-lg max-w-[15rem] md:max-w-sm leading-snug md:leading-relaxed line-clamp-2 md:line-clamp-none">
            {tagline}
          </p>
        )}
      </div>

      <BrandWave orientation="horizontal" className="absolute bottom-0 left-0 w-full h-6 md:hidden" />
      <BrandWave orientation="vertical" className="absolute top-0 right-0 h-full w-6 hidden md:block" />
    </div>
  );
}

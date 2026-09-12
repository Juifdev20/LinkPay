import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';

interface AuthBrandingPanelProps {
  headline: string;
  className?: string;
}

/**
 * Shared colored panel for the Login/Register pages — a solid brand-color
 * block with a soft oversized wave shape and a circular logo badge, matching
 * the reference design. Compact strip above the form on mobile, full-height
 * side panel on desktop (sizing controlled entirely via `className` from
 * each page, so this component stays layout-agnostic).
 */
export function AuthBrandingPanel({ headline, className }: AuthBrandingPanelProps) {
  return (
    <div className={cn('relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 flex-shrink-0', className)}>
      {/* Soft wave — an oversized blurred, rotated shape rather than an SVG
          asset, echoing the reference screenshot's wavy divide. */}
      <div className="absolute -bottom-1/2 -right-1/4 w-[140%] h-[140%] bg-background/10 rounded-[45%] rotate-12" />
      <div className="absolute -top-1/3 -left-1/4 w-[80%] h-[80%] bg-secondary/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 py-6 text-center gap-3 md:gap-5">
        <div className="w-14 h-14 md:w-20 md:h-20 rounded-full bg-background flex items-center justify-center shadow-lg flex-shrink-0">
          <Logo size="sm" showText={false} imgClassName="w-9 h-9 md:w-12 md:h-12 rounded-lg" />
        </div>
        <h1 className="text-xl md:text-4xl lg:text-5xl font-bold text-primary-foreground leading-tight">
          {headline}
        </h1>
      </div>
    </div>
  );
}

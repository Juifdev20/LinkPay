interface BrandWaveProps {
  /** 'horizontal' = wave along the bottom edge (panel stacked above content,
   * i.e. mobile). 'vertical' = wave along the right edge (panel beside
   * content, i.e. desktop). */
  orientation: 'horizontal' | 'vertical';
  className?: string;
}

/**
 * The soft curved boundary between the colored branding panel and the white
 * content next to it, matching the reference design's wave/cloud edge.
 * Filled with `fill-background` so it blends seamlessly into whatever sits
 * on the other side of the boundary (the page background).
 */
export function BrandWave({ orientation, className }: BrandWaveProps) {
  if (orientation === 'horizontal') {
    return (
      <svg
        className={className}
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0,40 C240,100 480,0 720,40 C960,80 1200,0 1440,40 L1440,120 L0,120 Z"
          className="fill-background"
        />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      viewBox="0 0 120 1440"
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M40,0 C100,240 0,480 40,720 C80,960 0,1200 40,1440 L120,1440 L120,0 Z"
        className="fill-background"
      />
    </svg>
  );
}

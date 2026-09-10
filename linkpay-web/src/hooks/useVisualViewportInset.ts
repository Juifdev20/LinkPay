import { useEffect, useState } from 'react';

/**
 * Height (in px) currently covered by the on-screen keyboard, derived from
 * `window.visualViewport` — the layout viewport (`window.innerHeight`,
 * everything CSS `100vh`/`h-screen` is based on) does NOT shrink when
 * Android's keyboard opens, but the *visual* viewport does. Comparing the
 * two is the standard way to detect the keyboard and its height on the web
 * (there is no dedicated keyboard API). Returns 0 when unsupported (older
 * Safari) or when the keyboard is closed.
 */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}

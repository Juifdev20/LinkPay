import { useEffect } from 'react';

/**
 * Publishes the height of the screen WITHOUT the on-screen keyboard as the CSS variable `--app-h`.
 *
 * Why: on an iPhone (and in the Android app, whose WebView is resized) the browser pushes whatever is fixed to the
 * bottom of the screen UP, above the keyboard — the bottom bar then floats in the middle of the screen. The bar must
 * stay at the bottom and let the keyboard cover it. Anchoring it from the TOP of the screen at `--app-h` minus its own
 * height (BottomNav) keeps it where it belongs whatever the browser does with the bottom edge: the height here is only
 * updated while nobody is typing, so the keyboard opening (the window shrinking) never changes it.
 *
 * Second case: the browser keeps the window as it is but PANS the page up to show the field being typed in
 * (`visualViewport.offsetTop` > 0). Fixed bars then travel with the page, the top bar leaves the screen and the bottom
 * bar rises. `--vv-top` is that pan; the two bars shift by it (`translate`) and so stay at the same place ON SCREEN.
 *
 * Re-measured when the window really changes (rotation, split screen, desktop resize) and as soon as the keyboard closes.
 */

const NO_KEYBOARD_TYPES = ['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'image'];

/** True while a field that opens the keyboard has the focus. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && !NO_KEYBOARD_TYPES.includes((el as HTMLInputElement).type);
}

export function useStableViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    let height = 0;
    const apply = (h: number) => {
      if (h > 0 && h !== height) {
        height = h;
        root.style.setProperty('--app-h', `${h}px`);
      }
    };
    const measure = () => { if (!isTyping()) apply(window.innerHeight); };
    measure();

    let timer: number | undefined;
    // The keyboard closing shrinks then restores the window over a few hundred ms: measure again once it settled.
    const settle = () => { window.clearTimeout(timer); timer = window.setTimeout(measure, 350); };
    const onRotate = () => { height = 0; settle(); };

    // The pan of the page by the browser (iPhone): the bars follow it back, so they never move on screen.
    const vv = window.visualViewport;
    const syncPan = () => root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv?.offsetTop ?? 0))}px`);
    vv?.addEventListener('scroll', syncPan);
    vv?.addEventListener('resize', syncPan);
    syncPan();

    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', onRotate);
    document.addEventListener('focusout', settle);
    document.addEventListener('visibilitychange', measure);
    return () => {
      window.clearTimeout(timer);
      vv?.removeEventListener('scroll', syncPan);
      vv?.removeEventListener('resize', syncPan);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', onRotate);
      document.removeEventListener('focusout', settle);
      document.removeEventListener('visibilitychange', measure);
    };
  }, []);
}

import { lazy, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Route-level code splitting. The app used to ship as one ~1.7 MB script
 * that a low-end phone had to parse entirely before showing anything; now
 * only the launch screens are in it, and each other page is its own chunk.
 */
const loaders: Array<() => Promise<unknown>> = [];

export function lazyPage<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  loaders.push(loader);
  return lazy(loader);
}

/**
 * Loads every split page in the background once the app is idle, so
 * opening any page later is instant (chunks come from the device or the
 * service-worker cache — no visible wait).
 */
export function prefetchPages() {
  const run = () => loaders.forEach((load) => load().catch(() => {}));
  const w = window as any;
  const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 1500);
  return () => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
}

/** Shown in place of a page whose chunk is still loading (rare after prefetch). */
export function PageFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'py-16'}`}>
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

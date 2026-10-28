import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';

/**
 * A round avatar: the picture when there is one, the silhouette on the brand gradient otherwise — and also while the
 * picture loads or if it cannot be loaded (offline, deleted file). `src` is the picture of the person or the company
 * it stands for; without it, the silhouette. For the signed-in person's own avatar use <SelfAvatar />.
 * A company logo is shown whole on white (`fit="contain"`), a face fills the circle.
 */
export function UserAvatar({ className, src, fit = 'cover', alt = '' }: { className?: string; src?: string | null; fit?: 'cover' | 'contain'; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); setLoaded(false); }, [src]);
  const showPicture = !!src && !failed;
  return (
    <span className={cn('relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#b9a6ff] to-[#7cc8ff] ring-2 ring-card', className)}>
      {/* The silhouette stays under the picture until it has loaded: no empty circle on a slow connection. */}
      {!(showPicture && loaded && fit === 'contain') && (
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <circle cx="20" cy="15.5" r="7" fill="white" fillOpacity="0.95" />
          <path d="M5 40c0-8.8 6.7-14.5 15-14.5S35 31.2 35 40" fill="white" fillOpacity="0.95" />
        </svg>
      )}
      {showPicture && (
        <img
          src={src!}
          alt={alt}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('absolute inset-0 h-full w-full transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0', fit === 'contain' ? 'bg-white object-contain p-[8%]' : 'object-cover')}
        />
      )}
    </span>
  );
}

/** The signed-in person's avatar: their photo (client, merchant) or their company's logo (everyone who works in one). */
export function SelfAvatar({ className }: { className?: string }) {
  const user = useAuthStore((s) => s.user);
  return <UserAvatar className={className} src={user?.avatar_url} fit={user?.avatar_kind === 'logo' ? 'contain' : 'cover'} alt={user?.avatar_kind === 'logo' ? 'Logo de l’entreprise' : 'Ma photo'} />;
}

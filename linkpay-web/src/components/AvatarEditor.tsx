import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useOnline } from '@/lib/network';
import { shrinkPicture, type ShrunkPicture } from '@/lib/image-compress';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SelfAvatar, UserAvatar } from '@/components/UserAvatar';
import { cn } from '@/lib/utils';

/** The people who change a company's logo: its owner and its gérants — never the rest of the staff. */
const LOGO_MANAGER_ROLES = ['enterprise', 'gerant'];

const errorText = (err: any) => {
  const m = err?.response?.data?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || err?.message || "L'enregistrement a échoué. Réessayez.";
};

/**
 * The profile photo of a client or a merchant, or the logo of the company for the people who work in one — with the
 * buttons to change it. A photo is changed by its owner as often as they want. A logo is changed only by the company's
 * owner or a gérant; the other staff see it with a short note. The picture is shrunk on the phone before it is sent
 * (a few tens of kilobytes) and the person sees the result before saving it.
 */
export function AvatarEditor({ className }: { className?: string }) {
  const user = useAuthStore((s) => s.user);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const online = useOnline();
  const isLogo = user?.avatar_kind === 'logo';
  const canEdit = !isLogo || LOGO_MANAGER_ROLES.includes(user?.role || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [picture, setPicture] = useState<ShrunkPicture | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'save' | 'remove' | null>(null);
  const [error, setError] = useState('');

  // The company the logo belongs to (the owner's, or the one the staff member works in).
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: isLogo && canEdit,
  });

  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.previewUrl); }, [picture]);

  const what = isLogo ? 'le logo' : 'la photo';
  const endpoint = isLogo ? (org?.id ? `/organizations/${org.id}/logo` : null) : '/users/me/avatar';

  const choose = async (file?: File | null) => {
    if (!file) return;
    setError('');
    setBusy('prepare');
    try {
      setPicture(await shrinkPicture(file, isLogo ? 'logo' : 'face'));
    } catch (err: any) {
      setError(err?.message || 'Cette image ne peut pas être utilisée.');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const save = async () => {
    if (!picture || !endpoint) return;
    setBusy('save');
    setError('');
    try {
      const body = new FormData();
      body.append('file', picture.blob, 'photo.webp');
      await api.put(endpoint, body, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 });
      await fetchProfile();
      setPicture(null);
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!endpoint) return;
    setBusy('remove');
    setError('');
    try {
      await api.delete(endpoint);
      await fetchProfile();
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const size = 'h-20 w-20';
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative">
        <SelfAvatar className={size} />
        {canEdit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!online || busy !== null || (isLogo && !endpoint)}
            aria-label={isLogo ? 'Changer le logo' : 'Changer la photo'}
            className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-card transition-transform active:scale-95 disabled:opacity-50"
          >
            {busy === 'prepare' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => void choose(e.target.files?.[0])} />
      </div>

      {canEdit ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <button type="button" className="text-sm font-semibold text-primary disabled:opacity-50" disabled={!online || busy !== null || (isLogo && !endpoint)} onClick={() => inputRef.current?.click()}>
            {user?.avatar_url ? (isLogo ? 'Changer le logo' : 'Changer la photo') : (isLogo ? 'Ajouter le logo' : 'Ajouter une photo')}
          </button>
          {user?.avatar_url && (
            <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground disabled:opacity-50" disabled={!online || busy !== null} onClick={() => void remove()}>
              {busy === 'remove' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Retirer {isLogo ? 'le logo' : 'la photo'}
            </button>
          )}
          {!online && <p className="max-w-[16rem] text-xs text-muted-foreground">Changer {what} demande Internet.</p>}
        </div>
      ) : (
        <p className="max-w-[16rem] text-center text-xs text-muted-foreground">Logo de l'entreprise : seul le responsable peut le changer.</p>
      )}
      {error && !picture && <p role="alert" className="max-w-[18rem] text-center text-xs text-destructive">{error}</p>}

      <Dialog open={!!picture} onOpenChange={(open) => { if (!open && busy !== 'save') { setPicture(null); setError(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isLogo ? 'Utiliser ce logo ?' : 'Utiliser cette photo ?'}</DialogTitle>
            <DialogDescription>Voici comment elle apparaîtra partout dans l'application.</DialogDescription>
          </DialogHeader>
          {picture && (
            <div className="flex flex-col items-center gap-3 py-2">
              <UserAvatar src={picture.previewUrl} fit={isLogo ? 'contain' : 'cover'} className="h-28 w-28" />
              <div className="flex items-center gap-3">
                <UserAvatar src={picture.previewUrl} fit={isLogo ? 'contain' : 'cover'} className="h-9 w-9" />
                <span className="text-xs text-muted-foreground">Allégée : {Math.max(1, Math.round(picture.blob.size / 1024))} Ko</span>
              </div>
              {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Button className="h-12 rounded-xl" onClick={() => void save()} disabled={busy === 'save' || !online}>
              {busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer
            </Button>
            <Button variant="outline" className="h-12 rounded-xl" disabled={busy === 'save'} onClick={() => inputRef.current?.click()}>Choisir une autre</Button>
            <Button variant="ghost" className="h-10 rounded-xl" disabled={busy === 'save'} onClick={() => { setPicture(null); setError(''); }}>Annuler</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Printer, Ban, Search, Check, Trash2, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatDate } from '@/lib/utils';
import { STATUS_LABEL } from '@/lib/cards';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/PageHeader';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const msg = (e: any) => e?.response?.data?.message || 'Une erreur est survenue.';
const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Toutes' },
  { value: 'requested', label: 'À préparer' },
  { value: 'issued', label: 'À remettre' },
  { value: 'active', label: 'Actives' },
  { value: 'frozen', label: 'En pause' },
  { value: 'blocked', label: 'Bloquées' },
];

interface CardRow {
  id: string; serial_no: number; status: keyof typeof STATUS_LABEL; holder_name: string | null; full_name: string | null; email: string | null;
  wallet_number: string | null; card_number_masked: string; expires_on: string | null; print_count: number; blocked_reason: string | null; created_at: string;
}

/** A logo picked by the super admin, reduced to a 256 px PNG so the card stays light. */
async function toLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Image PNG, JPEG ou WebP uniquement.');
  const bitmap = await createImageBitmap(file);
  for (const size of [256, 192, 128]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    ctx.drawImage(bitmap, (size - bitmap.width * scale) / 2, (size - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    const url = canvas.toDataURL('image/png');
    if (url.length <= 140_000) return url;
  }
  throw new Error('Image trop lourde.');
}

function SettingsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['card-settings'], queryFn: async () => (await api.get('/admin/cards/settings')).data });
  const [form, setForm] = useState<{ service_phone: string; lost_card_phone: string; web_domain: string; validity_years: string; partner_logos: { name: string; image: string }[] }>({
    service_phone: '', lost_card_phone: '', web_domain: '', validity_years: '3', partner_logos: [],
  });
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) setForm({ service_phone: data.service_phone ?? '', lost_card_phone: data.lost_card_phone ?? '', web_domain: data.web_domain ?? '', validity_years: String(data.validity_years ?? 3), partner_logos: data.partner_logos ?? [] });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => api.put('/admin/cards/settings', { ...form, validity_years: Number(form.validity_years) }),
    onSuccess: () => { setError(''); void qc.invalidateQueries({ queryKey: ['card-settings'] }); },
    onError: (e) => setError(msg(e)),
  });

  // The order here is the order on the back of the card, left to right.
  const move = (i: number, by: number) =>
    setForm((v) => {
      const logos = v.partner_logos.slice();
      [logos[i], logos[i + by]] = [logos[i + by], logos[i]];
      return { ...v, partner_logos: logos };
    });

  const addLogo = async (f?: File) => {
    if (!f) return;
    try {
      const image = await toLogo(f);
      setForm((v) => ({ ...v, partner_logos: [...v.partner_logos, { name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), image }] }));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Logo invalide.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Réglages de la carte</CardTitle>
        <p className="text-xs text-muted-foreground">Ce qui est imprimé sur la carte. Un champ vide n'est pas imprimé. Seul le super admin modifie ces réglages.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Téléphone du service client</Label>
            <Input value={form.service_phone} placeholder="+243 …" onChange={(e) => setForm({ ...form, service_phone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Téléphone « carte perdue ou volée »</Label>
            <Input value={form.lost_card_phone} placeholder="+243 …" aria-label="Téléphone carte perdue" onChange={(e) => setForm({ ...form, lost_card_phone: e.target.value })} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nom de domaine (QR code)</Label>
            <Input value={form.web_domain} placeholder="scanlinkpay.com" onChange={(e) => setForm({ ...form, web_domain: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Validité (années)</Label>
            <Input inputMode="numeric" value={form.validity_years} onChange={(e) => setForm({ ...form, validity_years: e.target.value })} />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Logos des partenaires (verso, 6 au plus)</Label>
          <div className="flex flex-wrap gap-3">
            {form.partner_logos.map((l, i) => (
              <div key={i} className="w-24 text-center space-y-1">
                <img src={l.image} alt={l.name} className="w-16 h-16 rounded-xl mx-auto border border-border object-cover" />
                <Input className="h-8 text-xs px-2" value={l.name} aria-label="Nom du logo" onChange={(e) => setForm({ ...form, partner_logos: form.partner_logos.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <div className="flex items-center justify-center gap-1">
                  <button type="button" aria-label="Déplacer à gauche" disabled={i === 0} className="p-1 disabled:opacity-30" onClick={() => move(i, -1)}><ChevronLeft className="w-4 h-4" /></button>
                  <button type="button" className="text-xs text-destructive inline-flex items-center gap-1" onClick={() => setForm({ ...form, partner_logos: form.partner_logos.filter((_, j) => j !== i) })}>
                    <Trash2 className="w-3 h-3" /> Retirer
                  </button>
                  <button type="button" aria-label="Déplacer à droite" disabled={i === form.partner_logos.length - 1} className="p-1 disabled:opacity-30" onClick={() => move(i, 1)}><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            {form.partner_logos.length < 6 && (
              <button type="button" onClick={() => file.current?.click()} className="w-16 h-16 rounded-xl border border-dashed border-border flex flex-col items-center justify-center text-xs text-muted-foreground">
                <Upload className="w-4 h-4" /> Ajouter
              </button>
            )}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void addLogo(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : save.isSuccess ? <Check className="w-4 h-4 mr-2" /> : null}
          Enregistrer
        </Button>
      </CardContent>
    </Card>
  );
}

/** Super admin: prepare, print and block the ScanLinkPay cards. */
export default function AdminCardsPage() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [walletNumber, setWalletNumber] = useState('');
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [blocking, setBlocking] = useState<CardRow | null>(null);
  const [reason, setReason] = useState('');
  const [blockError, setBlockError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-cards', status, q],
    queryFn: async () => (await api.get('/admin/cards', { params: { status: status || undefined, q: q.trim() || undefined } })).data,
  });
  const rows: CardRow[] = data?.data ?? [];

  const issue = useMutation({
    mutationFn: async (input: { wallet_number?: string; card_id?: string; replace?: boolean }) => (await api.post('/admin/cards/issue', input)).data,
    onSuccess: (r) => {
      setMessage({ ok: true, text: `Carte n° ${String(r.serial_no).padStart(6, '0')} préparée pour ${r.holder_name} (${r.wallet_number}).`, id: r.id });
      setWalletNumber('');
      setReplace(false);
      void qc.invalidateQueries({ queryKey: ['admin-cards'] });
    },
    onError: (e) => setMessage({ ok: false, text: msg(e) }),
  });

  const block = useMutation({
    mutationFn: async () => api.post(`/admin/cards/${blocking!.id}/block`, { reason: reason.trim() }),
    onSuccess: () => { setBlocking(null); setReason(''); void qc.invalidateQueries({ queryKey: ['admin-cards'] }); },
    onError: (e) => setBlockError(msg(e)),
  });

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-5 pb-28">
      <PageHeader title="Cartes ScanLinkPay" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Préparer une carte</CardTitle>
          <p className="text-xs text-muted-foreground">Tapez le numéro ScanLinkPay de la personne. La carte reste inactive jusqu'à ce que la personne l'active dans son application avec les 16 chiffres et son PIN.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setMessage(null); issue.mutate({ wallet_number: walletNumber.trim(), replace }); }}>
            <div className="flex gap-2">
              <Input aria-label="Numéro ScanLinkPay" placeholder="LP-00000001" value={walletNumber} onChange={(e) => setWalletNumber(e.target.value)} autoComplete="off" />
              <Button type="submit" disabled={issue.isPending || walletNumber.trim().length < 4}>
                {issue.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Préparer
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={replace} onCheckedChange={(v) => setReplace(v === true)} />
              Cette personne a déjà une carte : la remplacer (l'ancienne cesse de fonctionner)
            </label>
          </form>
          {message && (
            <div className={`mt-3 text-sm rounded-xl p-3 ${message.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`} role="status">
              {message.text}
              {message.ok && message.id && <Link className="ml-2 underline font-semibold" to={`/admin/cards/${message.id}/print`}>Imprimer</Link>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setStatus(f.value)} className={`px-3 py-1.5 rounded-full text-sm border ${status === f.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Nom, e-mail, numéro ScanLinkPay ou numéro de carte" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {isLoading ? (
          <div className="py-10"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Aucune carte.</p>
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {rows.map((c) => (
              <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{c.full_name || c.email || '—'}</p>
                    <Badge variant={c.status === 'active' ? 'success' : c.status === 'blocked' || c.status === 'expired' ? 'error' : 'warning'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.wallet_number} · n° {String(c.serial_no).padStart(6, '0')}{c.card_number_masked ? ` · ${c.card_number_masked}` : ''} · {formatDate(c.created_at)}
                    {c.print_count > 0 ? ` · imprimée ${c.print_count} fois` : ''}{c.blocked_reason ? ` · ${c.blocked_reason}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {c.status === 'requested' && (
                    <Button size="sm" disabled={issue.isPending} onClick={() => { setMessage(null); issue.mutate({ card_id: c.id }); }}>Préparer</Button>
                  )}
                  {c.status === 'issued' && (
                    <Button size="sm" asChild><Link to={`/admin/cards/${c.id}/print`}><Printer className="w-4 h-4 mr-1" /> Imprimer</Link></Button>
                  )}
                  {['requested', 'issued', 'active', 'frozen'].includes(c.status) && (
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setBlocking(c); setReason(''); setBlockError(''); }}>
                      <Ban className="w-4 h-4 mr-1" /> Bloquer
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {role === 'super_admin' && <SettingsPanel />}

      <Dialog open={!!blocking} onOpenChange={(o) => { if (!o) setBlocking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquer cette carte</DialogTitle>
            <DialogDescription>{blocking?.full_name || blocking?.email} sera prévenu. Le blocage est définitif : il faudra préparer une nouvelle carte.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Motif" placeholder="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          {blockError && <p className="text-sm text-destructive" role="alert">{blockError}</p>}
          <Button variant="destructive" disabled={block.isPending || reason.trim().length < 3} onClick={() => block.mutate()}>
            {block.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Bloquer la carte
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

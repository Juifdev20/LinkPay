import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { FormSheet } from '@/components/FormSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  ClipboardList, Plus, Loader2, Store, CheckCircle,
  TrendingDown, TrendingUp, Search, XCircle,
} from 'lucide-react';

function errMsg(err: any, fallback: string) {
  const msg = err?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

const STATUS: Record<string, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  counting: { label: 'En cours', variant: 'secondary' },
  completed: { label: 'Terminé', variant: 'outline' },
  cancelled: { label: 'Annulé', variant: 'destructive' },
};

/**
 * Inventaires physiques (spec 1.4) — comptages totaux ou par rayon
 * (catégorie), saisie des quantités constatées sans arrêter les ventes,
 * puis validation qui réaligne le stock et produit le rapport de démarque.
 */
export default function InventoryPage() {
  const user = useAuthStore((s) => s.user);
  const [pickedMerchant, setPickedMerchant] = useState('');
  const [selectedCount, setSelectedCount] = useState<string | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !user?.merchant_id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !user?.merchant_id && !!org?.id,
  });

  const merchantId = user?.merchant_id || pickedMerchant || (merchants?.length === 1 ? merchants[0].id : '');

  const { data: items } = useQuery({
    queryKey: ['stock-items', merchantId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/stock-items`)).data,
    enabled: !!merchantId,
  });
  const categories = useMemo(
    () => [...new Set((items || []).map((i: any) => i.category).filter(Boolean))] as string[],
    [items],
  );

  const { data: countsData, isLoading } = useQuery({
    queryKey: ['inventory-counts', merchantId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/inventory-counts`, { params: { limit: 30 } })).data,
    enabled: !!merchantId,
  });
  const counts: any[] = countsData?.data || [];

  const selected = counts.find((c) => c.id === selectedCount);
  const counting = counts.find((c) => c.status === 'counting');

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-5 max-w-3xl lg:max-w-5xl mx-auto">
      <PageHeader title="Inventaires" />

      {!user?.merchant_id && merchants?.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {merchants.map((m: any) => (
            <button
              key={m.id}
              onClick={() => { setPickedMerchant(m.id); setSelectedCount(null); }}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${merchantId === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {merchantId && selected ? (
        <CountDetail merchantId={merchantId} countId={selected.id} onBack={() => setSelectedCount(null)} />
      ) : merchantId && counting ? (
        <CountingView merchantId={merchantId} countId={counting.id} />
      ) : merchantId ? (
        <CountsList
          merchantId={merchantId}
          counts={counts}
          isLoading={isLoading}
          categories={categories}
          onOpen={setSelectedCount}
        />
      ) : (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">
          <Store className="w-8 h-8 mx-auto mb-2" /> Aucune boutique disponible.
        </CardContent></Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Liste + création
// ---------------------------------------------------------------------
function CountsList({
  merchantId, counts, isLoading, categories, onOpen,
}: { merchantId: string; counts: any[]; isLoading: boolean; categories: string[]; onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [scope, setScope] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/inventory-counts`, {
        scope_category: scope || undefined,
        notes: notes || undefined,
      });
      setShowNew(false);
      setScope('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['inventory-counts', merchantId] });
    } catch (err: any) {
      setError(errMsg(err, "Impossible de démarrer l'inventaire"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button className="w-full" onClick={() => setShowNew(true)}>
        <Plus className="mr-2 w-4 h-4" /> Nouvel inventaire
      </Button>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

      {!isLoading && !counts.length && (
        <Card><CardContent className="pt-6 text-center space-y-2">
          <ClipboardList className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Aucun inventaire. Lancez un comptage général ou par rayon pour comparer le stock théorique au stock réel.
          </p>
        </CardContent></Card>
      )}

      {counts.map((c) => (
        <button key={c.id} onClick={() => onOpen(c.id)} className="w-full text-left">
          <Card className="hover:bg-accent/40 transition-colors">
            <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {c.scope_category ? `Rayon « ${c.scope_category} »` : 'Inventaire général'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(c.created_at)} · {c.lines?.[0]?.count ?? 0} produit(s)
                </p>
              </div>
              <Badge variant={STATUS[c.status]?.variant || 'outline'}>{STATUS[c.status]?.label || c.status}</Badge>
            </CardContent>
          </Card>
        </button>
      ))}

      {showNew && (
        <FormSheet onClose={() => setShowNew(false)} title="Nouvel inventaire">
          <div className="p-6 max-w-lg mx-auto space-y-4">
            <p className="font-semibold text-foreground">Nouvel inventaire</p>
            {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}
            <div className="space-y-2">
              <Label>Périmètre</Label>
              <Select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">Inventaire général (toute la boutique)</option>
                {categories.map((c) => <option key={c} value={c}>Rayon « {c} »</option>)}
              </Select>
              <p className="text-xs text-muted-foreground">Un inventaire tournant par rayon permet de contrôler sans fermer toute la boutique.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optionnel)</Label>
              <Input id="notes" placeholder="Ex : inventaire mensuel, contrôle surprise…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button className="w-full" disabled={busy} onClick={create}>
              {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Démarrer le comptage
            </Button>
          </div>
        </FormSheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Saisie du comptage — buffer local, sauvegarde partielle, validation
// ---------------------------------------------------------------------
function CountingView({ merchantId, countId }: { merchantId: string; countId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [done, setDone] = useState<any>(null);

  const { data: count, isLoading } = useQuery({
    queryKey: ['inventory-count', countId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/inventory-counts/${countId}`)).data,
  });

  const lines: any[] = count?.lines || [];
  const dirtyLines = lines.filter((l) => draft[l.id] !== undefined && draft[l.id] !== '' && Number(draft[l.id]) !== l.counted_qty);
  const filtered = search
    ? lines.filter((l) => l.product_name_snapshot.toLowerCase().includes(search.toLowerCase()))
    : lines;

  const save = async () => {
    if (!dirtyLines.length) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/merchants/${merchantId}/inventory-counts/${countId}/lines`, {
        lines: dirtyLines.map((l) => ({ line_id: l.id, counted_qty: Math.max(0, Math.floor(Number(draft[l.id]))) })),
      });
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ['inventory-count', countId] });
    } catch (err: any) {
      setError(errMsg(err, 'Sauvegarde impossible'));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    setBusy(true);
    setError('');
    try {
      if (dirtyLines.length) await save();
      const { data } = await api.post(`/merchants/${merchantId}/inventory-counts/${countId}/complete`);
      setDone(data);
      queryClient.invalidateQueries({ queryKey: ['inventory-counts', merchantId] });
      queryClient.invalidateQueries({ queryKey: ['stock-items', merchantId] });
    } catch (err: any) {
      setError(errMsg(err, 'Validation impossible'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      await api.post(`/merchants/${merchantId}/inventory-counts/${countId}/cancel`);
      queryClient.invalidateQueries({ queryKey: ['inventory-counts', merchantId] });
    } catch (err: any) {
      setError(errMsg(err, 'Annulation impossible'));
    }
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (done) return <CountReport count={done} />;

  const report = count?.report;
  const progress = report?.total_lines ? Math.round((report.counted_lines / report.total_lines) * 100) : 0;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground">
              {count?.scope_category ? `Rayon « ${count.scope_category} »` : 'Inventaire général'}
            </p>
            <Badge variant="secondary">{report?.counted_lines ?? 0}/{report?.total_lines ?? 0} comptés</Badge>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Saisissez les quantités réellement comptées. Les ventes peuvent continuer — l'écart est calculé à la validation.
          </p>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Filtrer les produits…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Mobile — one card per product */}
      <div className="space-y-2 md:hidden">
        {filtered.map((l) => {
          const current = draft[l.id] ?? (l.counted_qty !== null ? String(l.counted_qty) : '');
          const diff = current !== '' ? Number(current) - l.expected_qty : null;
          return (
            <Card key={l.id}>
              <CardContent className="pt-3 pb-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{l.product_name_snapshot}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.category_snapshot || 'Sans rayon'} · théorique : {l.expected_qty}
                  </p>
                </div>
                {diff !== null && diff !== 0 && (
                  <span className={`text-xs font-bold flex-shrink-0 ${diff < 0 ? 'text-destructive' : 'text-success'}`}>
                    {diff > 0 ? '+' : ''}{diff}
                  </span>
                )}
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="w-20 text-center"
                  placeholder="Qté"
                  value={current}
                  onChange={(e) => setDraft({ ...draft, [l.id]: e.target.value })}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop — dense table; Enter moves to the next product so a full
          count can be typed keyboard-only. */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-3 pl-4 pr-3 font-medium">Produit</th>
                <th className="py-3 pr-3 font-medium">Rayon</th>
                <th className="py-3 pr-3 font-medium text-right w-24">Théorique</th>
                <th className="py-3 pr-3 font-medium text-center w-28">Compté</th>
                <th className="py-3 pr-4 font-medium text-right w-20">Écart</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, idx) => {
                const current = draft[l.id] ?? (l.counted_qty !== null ? String(l.counted_qty) : '');
                const diff = current !== '' ? Number(current) - l.expected_qty : null;
                return (
                  <tr key={l.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                    <td className="py-2 pl-4 pr-3 font-medium text-foreground">{l.product_name_snapshot}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{l.category_snapshot || '—'}</td>
                    <td className="py-2 pr-3 text-right text-muted-foreground">{l.expected_qty}</td>
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="w-24 mx-auto text-center h-9"
                        placeholder="Qté"
                        value={current}
                        data-count-idx={idx}
                        onChange={(e) => setDraft({ ...draft, [l.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const next = document.querySelector<HTMLInputElement>(`[data-count-idx="${idx + 1}"]`);
                            if (next) { next.focus(); next.select(); }
                          }
                        }}
                      />
                    </td>
                    <td className={`py-2 pr-4 text-right font-bold ${diff === null || diff === 0 ? 'text-muted-foreground' : diff < 0 ? 'text-destructive' : 'text-success'}`}>
                      {diff !== null && diff !== 0 ? `${diff > 0 ? '+' : ''}${diff}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun produit ne correspond au filtre.</p>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-20 md:bottom-6 grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={save} disabled={busy || !dirtyLines.length}>
          {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
          Sauvegarder{dirtyLines.length ? ` (${dirtyLines.length})` : ''}
        </Button>
        <Button onClick={() => setConfirmComplete(true)} disabled={busy || !(report?.counted_lines || dirtyLines.length)}>
          <CheckCircle className="mr-2 w-4 h-4" /> Valider
        </Button>
      </div>

      <button onClick={() => setConfirmCancel(true)} className="w-full text-sm text-destructive hover:underline flex items-center justify-center gap-1.5">
        <XCircle className="w-4 h-4" /> Abandonner cet inventaire
      </button>

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title="Valider l'inventaire ?"
        description="Le stock sera réaligné sur les quantités comptées et le rapport de démarque généré. Les lignes non comptées ne seront pas touchées."
        confirmLabel="Valider et ajuster le stock"
        onConfirm={() => { setConfirmComplete(false); complete(); }}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Abandonner l'inventaire ?"
        description="Les comptages saisis seront perdus, aucun ajustement de stock ne sera fait."
        confirmLabel="Abandonner"
        variant="destructive"
        onConfirm={cancel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Rapport — démarque (écarts valorisés au prix de vente)
// ---------------------------------------------------------------------
function CountReport({ count }: { count: any }) {
  const lines: any[] = count?.lines || [];
  const varianceLines = lines.filter((l) => l.variance !== null && l.variance !== 0);
  const report = count?.report;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-success" /> Rapport de démarque
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Périmètre</span><span className="text-foreground">{count.scope_category ? `Rayon « ${count.scope_category} »` : 'Général'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Produits comptés</span><span className="text-foreground">{report?.counted_lines}/{report?.total_lines}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Écarts constatés</span><span className="text-foreground">{report?.variance_lines ?? varianceLines.length}</span></div>
          {Object.entries(report?.loss_cents_by_currency || {}).map(([cur, cents]) => (
            <div key={cur} className="flex justify-between font-semibold text-destructive">
              <span>Pertes ({cur})</span><span>−{formatCurrency(cents as number, cur)}</span>
            </div>
          ))}
          {Object.entries(report?.gain_cents_by_currency || {}).map(([cur, cents]) => (
            <div key={cur} className="flex justify-between font-semibold text-success">
              <span>Excédents ({cur})</span><span>+{formatCurrency(cents as number, cur)}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Écarts valorisés au prix de vente. Le stock a été réaligné sur les quantités comptées.</p>
        </CardContent>
      </Card>

      {varianceLines.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Détail des écarts</CardTitle></CardHeader>
          <CardContent className="space-y-2 md:space-y-0 md:p-0">
            {/* Mobile rows */}
            <div className="md:hidden space-y-2">
              {varianceLines.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{l.product_name_snapshot}</p>
                    <p className="text-xs text-muted-foreground">théorique {l.expected_qty} → compté {l.counted_qty}</p>
                  </div>
                  <span className={`flex items-center gap-1 font-bold flex-shrink-0 ${l.variance < 0 ? 'text-destructive' : 'text-success'}`}>
                    {l.variance < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                    {l.variance > 0 ? '+' : ''}{l.variance}
                  </span>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2.5 pl-4 pr-3 font-medium">Produit</th>
                  <th className="py-2.5 pr-3 font-medium text-right w-24">Théorique</th>
                  <th className="py-2.5 pr-3 font-medium text-right w-24">Compté</th>
                  <th className="py-2.5 pr-4 font-medium text-right w-24">Écart</th>
                </tr>
              </thead>
              <tbody>
                {varianceLines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pl-4 pr-3 font-medium text-foreground">{l.product_name_snapshot}</td>
                    <td className="py-2.5 pr-3 text-right text-muted-foreground">{l.expected_qty}</td>
                    <td className="py-2.5 pr-3 text-right text-foreground">{l.counted_qty}</td>
                    <td className={`py-2.5 pr-4 text-right font-bold ${l.variance < 0 ? 'text-destructive' : 'text-success'}`}>
                      <span className="inline-flex items-center gap-1">
                        {l.variance < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                        {l.variance > 0 ? '+' : ''}{l.variance}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Read-only view of a past (completed/cancelled) count from the list. */
function CountDetail({ merchantId, countId, onBack }: { merchantId: string; countId: string; onBack: () => void }) {
  const { data: count, isLoading } = useQuery({
    queryKey: ['inventory-count', countId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/inventory-counts/${countId}`)).data,
  });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!count) return null;

  // An in-progress count opened from the list goes back to the counting UI.
  if (count.status === 'counting') return <CountingView merchantId={merchantId} countId={countId} />;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">← Retour aux inventaires</button>
      {count.status === 'completed' ? (
        <CountReport count={count} />
      ) : (
        <Card><CardContent className="pt-6 text-center text-muted-foreground text-sm">
          Inventaire {STATUS[count.status]?.label.toLowerCase()} — aucun rapport.
        </CardContent></Card>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/lib/utils';
import { ScrollText, Loader2, ShieldAlert } from 'lucide-react';

const ACTION_LABELS: Record<string, string> = {
  ticket_cancelled: 'Ticket annulé',
  pos_line_voided: 'Ligne de ticket annulée',
  pos_payment_voided: 'Paiement ScanLinkPay retiré',
  pos_tva_rate_changed: 'Taux de TVA modifié',
  cash_session_opened: 'Session de caisse ouverte',
  cash_session_closed: 'Session de caisse clôturée',
  inventory_started: 'Inventaire démarré',
  inventory_completed: 'Inventaire validé',
  inventory_cancelled: 'Inventaire abandonné',
  stock_adjusted: 'Stock ajusté',
  price_changed: 'Prix modifié',
};

function describe(entry: any): string {
  const c = entry.changes || {};
  switch (entry.action) {
    case 'pos_line_voided':
      return `${c.product || 'article'} ×${c.quantity ?? ''}${c.reason ? ` — ${c.reason}` : ''}${c.authorized_by ? ' (autorisé)' : ''}`;
    case 'ticket_cancelled':
      return c.reason ? `Motif : ${c.reason}` : 'Sans motif';
    case 'cash_session_closed':
      return `Écart : ${((c.discrepancy_cents || 0) / 100).toLocaleString('fr-CD')}`;
    case 'cash_session_opened':
      return `Fond : ${((c.opening_float_cents || 0) / 100).toLocaleString('fr-CD')} ${c.currency || ''}`;
    case 'price_changed':
      return `${((c.old_price_cents || 0) / 100).toLocaleString('fr-CD')} → ${((c.new_price_cents || 0) / 100).toLocaleString('fr-CD')}`;
    case 'pos_tva_rate_changed':
      return `Nouveau taux : ${c.tva_rate_pct}%`;
    case 'pos_payment_voided':
      return `${c.method === 'scanlinkpay' ? 'ScanLinkPay' : c.method} — ${((c.amount_cents || 0) / 100).toLocaleString('fr-CD')}`;
    case 'inventory_started':
      return `Périmètre : ${c.scope_category || 'général'} · ${c.lines ?? ''} produits`;
    case 'inventory_completed':
      return `${c.counted_lines ?? ''} lignes comptées · ${c.adjusted_items ?? 0} ajustement(s)`;
    case 'stock_adjusted':
      return `${c.old_quantity ?? '?'} → ${c.new_quantity ?? '?'}${c.reason ? ` — ${c.reason}` : ''}`;
    default:
      return Object.keys(c).length ? JSON.stringify(c) : '';
  }
}

/**
 * Journal d'activité (spec 3.2 "traçabilité") — chaque action critique
 * (annulation de ticket/ligne, modification de prix, ajustement de stock,
 * ouverture/fermeture de caisse, inventaire) avec qui, quand, quoi.
 */
export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['org-audit-log', org?.id, action, page],
    queryFn: async () =>
      (await api.get(`/organizations/${org.id}/audit-log`, {
        params: { action: action || undefined, page, limit: 30 },
      })).data,
    enabled: !!org?.id,
  });

  const entries: any[] = data?.data || [];
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 30)));

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-5 max-w-3xl mx-auto">
      <PageHeader title="Journal d'activité" />

      <div className="flex items-center gap-3">
        <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="flex-1">
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      {isLoading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

      {!isLoading && !entries.length && (
        <Card><CardContent className="pt-6 text-center space-y-2">
          <ScrollText className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {entries.map((e) => (
          <Card key={e.id}>
            <CardContent className="pt-3 pb-3 flex items-start gap-3">
              <ShieldAlert className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {ACTION_LABELS[e.action] || e.action}
                </p>
                {describe(e) && <p className="text-xs text-muted-foreground truncate">{describe(e)}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-medium text-foreground">{e.user?.full_name || e.user?.email || 'Système'}</p>
                <p className="text-xs text-muted-foreground">{formatDate(e.created_at)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
        </div>
      )}
    </div>
  );
}

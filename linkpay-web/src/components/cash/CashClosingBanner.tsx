import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Home-screen reminder for the station's seller / cashier / manager: the day's cash is still to be closed
 * (or already closed). Nothing is shown before the first cash movement of the day.
 */
export function CashClosingBanner({ stationId: chosen }: { stationId?: string | null } = {}) {
  const user = useAuthStore((s) => s.user);
  // The owner picks the station on the home screen; staff work in their own.
  const stationId = chosen ?? user?.station_id;
  const allowed = !!chosen || ['caissier', 'vendeur', 'gerant'].includes(user?.role || '');
  const currency = (() => { try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; } })();

  const { data } = useQuery({
    queryKey: ['cash-day', stationId, null, currency],
    queryFn: async () => (await api.get(`/merchants/${stationId}/cash-book/day`, { params: { currency } })).data,
    enabled: !!stationId && allowed,
    staleTime: 30_000,
    retry: false,
  });
  if (data?.previous_unclosed_day) {
    const day = new Date(`${data.previous_unclosed_day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <Link to="/dashboard/organization/cash" className="flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-rose-600" />
        <span className="flex-1 font-medium text-foreground">Clôturez d’abord la caisse du {day} avant d’opérer aujourd’hui</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    );
  }
  if (!data || (!data.entries.length && !data.non_cash.length)) return null;

  if (data.closed) {
    return (
      <Link to="/dashboard/organization/cash" className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
        <span className="flex-1 font-medium text-foreground">Caisse du jour clôturée</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    );
  }
  return (
    <Link to="/dashboard/organization/cash" className="flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
      <span className="flex-1 font-medium text-foreground">{data.closing?.status === 'reopened' ? 'Caisse déverrouillée — à clôturer de nouveau' : 'Caisse du jour à clôturer'}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

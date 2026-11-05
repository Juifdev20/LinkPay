import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Power, PowerOff, Search } from 'lucide-react';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormSheet } from '@/components/FormSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/**
 * Activer ou désactiver l'abonnement d'une entreprise à la main (essais, dépannages, gestes commerciaux), pour un
 * nombre de jours ou de mois, sans paiement. Chaque action est enregistrée (qui, quand, combien) et demande le code OTP du
 * super admin. Désactiver met fin à l'abonnement en cours : l'entreprise peut ensuite s'abonner normalement.
 */
interface Org {
  id: string;
  name: string;
  owner_name: string | null;
  status: 'active' | 'trial' | 'expired' | 'none';
  expires_at: string | null;
  days_left: number | null;
  trial_ends_at: string;
  trial_active: boolean;
  paid_until: string | null;
}

const RACCOURCIS: { libelle: string; amount: number; unit: 'days' | 'months' }[] = [
  { libelle: '7 jours', amount: 7, unit: 'days' },
  { libelle: '15 jours', amount: 15, unit: 'days' },
  { libelle: '30 jours', amount: 30, unit: 'days' },
  { libelle: '3 mois', amount: 3, unit: 'months' },
  { libelle: '6 mois', amount: 6, unit: 'months' },
  { libelle: '12 mois', amount: 12, unit: 'months' },
];

const erreur = (e: any, defaut = 'Une erreur est survenue') => {
  const m = e?.response?.data?.message;
  return typeof m === 'string' ? m : Array.isArray(m) ? m.join(' • ') : typeof m?.message === 'string' ? m.message : defaut;
};

function Etat({ o }: { o: Org }) {
  const base = 'inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold';
  if (o.status === 'active')
    return <span className={`${base} bg-success/10 text-success`}>Actif jusqu'au {formatDate(o.expires_at!)} ({o.days_left} j){o.paid_until ? ' · payé' : ' · offert'}</span>;
  if (o.status === 'trial') return <span className={`${base} bg-primary/10 text-primary`}>Essai gratuit jusqu'au {formatDate(o.trial_ends_at)}</span>;
  if (o.status === 'expired') return <span className={`${base} bg-destructive/10 text-destructive`}>Expiré le {formatDate(o.expires_at!)}</span>;
  return <span className={`${base} bg-warning/10 text-warning`}>Essai terminé · pas d'abonnement</span>;
}

/** La date de fin qu'on obtiendra : on s'ajoute à la fin en cours, ou on repart de maintenant. */
function finPrevue(o: Org, amount: number, unit: 'days' | 'months') {
  const debut = Math.max(o.expires_at ? new Date(o.expires_at).getTime() : 0, Date.now());
  const d = new Date(debut);
  if (unit === 'days') d.setDate(d.getDate() + amount);
  else d.setMonth(d.getMonth() + amount);
  return d;
}

function ActiverSheet({ org, onClose, onDone }: { org: Org; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<'days' | 'months'>('days');
  const [reason, setReason] = useState('');
  const n = /^\d+$/.test(amount) ? Number(amount) : 0;
  const max = unit === 'days' ? 730 : 24;
  const valide = n >= 1 && n <= max;
  const fin = useMemo(() => (valide ? finPrevue(org, n, unit) : null), [org, n, unit, valide]);
  const activer = useMutation({
    mutationFn: async () => (await api.post(`/admin/subscription/organizations/${org.id}/grant`, { amount: n, unit, reason: reason.trim() || undefined })).data,
    onSuccess: onDone,
  });

  return (
    <FormSheet onClose={onClose} title={`Activer ${org.name}`} size="narrow">
      <div className="p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold">Activer {org.name}</h2>
          <div className="mt-1">
            <Etat o={org} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {RACCOURCIS.map((r) => (
            <button
              key={r.libelle}
              type="button"
              onClick={() => {
                setAmount(String(r.amount));
                setUnit(r.unit);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${amount === String(r.amount) && unit === r.unit ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              {r.libelle}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="duree">Durée</Label>
            <Input id="duree" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unite">En</Label>
            <Select id="unite" value={unit} onChange={(e) => setUnit(e.target.value as 'days' | 'months')}>
              <option value="days">Jours</option>
              <option value="months">Mois</option>
            </Select>
          </div>
        </div>
        {!valide && amount !== '' && <p className="text-xs text-destructive">Entre 1 et {max} {unit === 'days' ? 'jours' : 'mois'}.</p>}

        <div className="space-y-1.5">
          <Label htmlFor="motif">
            Motif <span className="text-muted-foreground font-normal">(facultatif, gardé dans l'historique)</span>
          </Label>
          <Input id="motif" placeholder="Test de la facture normalisée, geste commercial…" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {fin && (
          <p className="rounded-xl bg-success/10 text-success text-sm p-3">
            L'abonnement sera actif jusqu'au <strong>{formatDate(fin.toISOString())}</strong>
            {org.status === 'active' ? ' (les jours s’ajoutent à ce qui reste).' : ' (accès immédiat).'}
          </p>
        )}
        {activer.error && <p className="text-sm text-destructive">{erreur(activer.error, "Activation impossible")}</p>}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button className="flex-1" disabled={!valide || activer.isPending} onClick={() => activer.mutate()}>
            {activer.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Activer'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Aucun paiement n'est demandé à l'entreprise. Un code de confirmation (OTP) vous sera demandé.</p>
      </div>
    </FormSheet>
  );
}

export function OrganizationAccessCard() {
  const qc = useQueryClient();
  const [saisie, setSaisie] = useState('');
  const [recherche, setRecherche] = useState('');
  const [aActiver, setAActiver] = useState<Org | null>(null);
  const [aDesactiver, setADesactiver] = useState<Org | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setRecherche(saisie.trim()), 300);
    return () => clearTimeout(t);
  }, [saisie]);

  const { data, isLoading } = useQuery<{ organizations: Org[]; total: number }>({
    queryKey: ['admin-sub-orgs', recherche],
    queryFn: async () => (await api.get('/admin/subscription/organizations', { params: { search: recherche || undefined, limit: 30 } })).data,
  });
  const apres = () => {
    qc.invalidateQueries({ queryKey: ['admin-sub-orgs'] });
    qc.invalidateQueries({ queryKey: ['admin-subscription'] });
  };

  const desactiver = useMutation({
    mutationFn: async (o: Org) =>
      (await api.post(`/admin/subscription/organizations/${o.id}/revoke`, { confirm_paid: !!(o.paid_until && new Date(o.paid_until) > new Date()) || undefined })).data,
    onSuccess: (r: any) => {
      setMessage({ ok: true, texte: `Abonnement de ${r.name} désactivé. L'entreprise peut maintenant s'abonner.` });
      setADesactiver(null);
      apres();
    },
    onError: (e) => {
      setMessage({ ok: false, texte: erreur(e, 'Désactivation impossible') });
      setADesactiver(null);
    },
  });

  const paye = !!aDesactiver?.paid_until && new Date(aDesactiver.paid_until) > new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Activer une entreprise à la main</CardTitle>
        <p className="text-xs text-muted-foreground">
          Pour les tests, les dépannages et les gestes commerciaux : donnez à une entreprise un nombre de jours ou de mois, sans paiement. Désactiver met fin
          à l'abonnement en cours : l'entreprise peut ensuite s'abonner normalement. Chaque action est enregistrée.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label="Chercher une entreprise" className="pl-9" placeholder="Chercher une entreprise par son nom" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        </div>
        {message && (
          <p className={`text-sm flex items-start gap-1.5 ${message.ok ? 'text-success' : 'text-destructive'}`}>
            {message.ok && <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            {message.texte}
          </p>
        )}
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />}
        {!isLoading && !data?.organizations?.length && <p className="text-sm text-muted-foreground text-center py-4">Aucune entreprise trouvée.</p>}
        <div className="divide-y divide-border">
          {(data?.organizations ?? []).map((o) => (
            <div key={o.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{o.name}</p>
                {o.owner_name && <p className="text-xs text-muted-foreground truncate">Patron : {o.owner_name}</p>}
                <div className="mt-1">
                  <Etat o={o} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { setMessage(null); setAActiver(o); }}>
                  <Power className="mr-1.5 w-4 h-4" /> Activer
                </Button>
                {o.status === 'active' && (
                  <Button size="sm" variant="outline" onClick={() => { setMessage(null); setADesactiver(o); }}>
                    <PowerOff className="mr-1.5 w-4 h-4" /> Désactiver
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {(data?.total ?? 0) > (data?.organizations?.length ?? 0) && (
          <p className="text-xs text-muted-foreground text-center">{data!.total} entreprises : précisez la recherche pour affiner la liste.</p>
        )}
      </CardContent>

      {aActiver && (
        <ActiverSheet
          org={aActiver}
          onClose={() => setAActiver(null)}
          onDone={() => {
            setMessage({ ok: true, texte: `${aActiver.name} est activée. Le patron en est prévenu.` });
            setAActiver(null);
            apres();
          }}
        />
      )}
      <ConfirmDialog
        open={!!aDesactiver}
        onOpenChange={(o) => !o && setADesactiver(null)}
        title={`Désactiver ${aDesactiver?.name ?? ''} ?`}
        description={
          paye
            ? "ATTENTION : cette entreprise a PAYÉ un abonnement qui court encore. Le désactiver lui fait perdre ce qu'elle a payé. Elle devra se réabonner."
            : "L'abonnement en cours prend fin tout de suite. L'entreprise pourra s'abonner normalement depuis son espace."
        }
        confirmLabel={paye ? 'Désactiver malgré le paiement' : 'Désactiver'}
        variant="destructive"
        onConfirm={() => aDesactiver && desactiver.mutate(aDesactiver)}
      />
    </Card>
  );
}

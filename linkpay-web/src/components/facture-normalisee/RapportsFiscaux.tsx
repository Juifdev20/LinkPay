import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CalendarRange, Loader2, Lock, Package, Printer } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSheet } from '@/components/FormSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PrintFlowStatus, ReceiptPreview, usePrintFlow } from '@/components/printing/ReceiptPrint';
import { buildRapportFiscal, dateRapport, titreRapport, type VueRapportFiscal } from '@/lib/printing/build-rapport-fiscal';
import { formatCurrency } from '@/lib/utils';
import { messageErreur } from './shared';

/**
 * Rapports de la facture normalisée (note de service 01/022, 1.3 et 1.4) :
 *   X  — ce qui a été normalisé depuis la dernière clôture, sans rien fermer (patron, gérants, comptable) ;
 *   XP — la même chose pour une période choisie ;
 *   Z  — la clôture : numérotée, elle ferme la période (patron, gérants) ;
 *   A  — les articles vendus, retournés et en stock depuis le dernier rapport A (patron, gérants).
 * Chaque rapport est gardé tel quel dans le journal : on le réimprime, on ne le refait pas.
 */
export function RapportsFiscaux({ orgId, gestion }: { orgId: string; gestion: boolean }) {
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [ouvert, setOuvert] = useState<VueRapportFiscal | string | null>(null);
  const [periode, setPeriode] = useState<{ debut: string; fin: string } | null>(null);
  const [confirmerZ, setConfirmerZ] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cle = ['rapports-fiscaux', orgId, type];
  const { data, isLoading } = useQuery({
    queryKey: cle,
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/rapports`, { params: { type: type || undefined } })).data,
  });

  const creer = useMutation({
    mutationFn: async ({ chemin, corps }: { chemin: 'x' | 'xp' | 'z' | 'a'; corps?: any }) =>
      (await api.post(`/organizations/${orgId}/facture-normalisee/rapports/${chemin}`, corps)).data as VueRapportFiscal,
    onSuccess: (r) => {
      setMessage(null);
      setPeriode(null);
      qc.invalidateQueries({ queryKey: ['rapports-fiscaux', orgId] });
      setOuvert(r);
    },
    onError: (e) => setMessage(messageErreur(e, 'Rapport impossible')),
  });
  const enCours = creer.isPending ? creer.variables?.chemin : null;

  const periodeValide = periode && periode.debut && periode.fin && periode.fin >= periode.debut;
  const lancerXP = () => {
    if (!periode || !periodeValide) return;
    // Journées entières, à l'heure de Kinshasa (UTC+1).
    creer.mutate({ chemin: 'xp', corps: { debut: `${periode.debut}T00:00:00+01:00`, fin: `${periode.fin}T23:59:59+01:00` } });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Bouton icone={<BarChart3 className="w-5 h-5" />} titre="Rapport X" texte="Depuis la dernière clôture. Ne ferme rien." charge={enCours === 'x'} onClick={() => creer.mutate({ chemin: 'x' })} />
        <Bouton
          icone={<CalendarRange className="w-5 h-5" />}
          titre="Rapport X périodique"
          texte="Pour les dates de votre choix."
          onClick={() => setPeriode(periode ? null : { debut: '', fin: new Date().toISOString().slice(0, 10) })}
        />
        {gestion && (
          <>
            <Bouton
              icone={<Lock className="w-5 h-5" />}
              titre={`Clôture Z n° ${data?.prochain_z ?? '…'}`}
              texte={data?.dernier_z ? `Depuis le Z n° ${data.dernier_z.seq} du ${dateRapport(data.dernier_z.period_end)}` : 'Première clôture depuis l’activation.'}
              ton="fort"
              charge={enCours === 'z'}
              onClick={() => setConfirmerZ(true)}
            />
            <Bouton
              icone={<Package className="w-5 h-5" />}
              titre="Rapport A (articles)"
              texte={data?.dernier_a ? `Depuis le rapport A n° ${data.dernier_a.seq}` : 'Vendu, retourné et en stock.'}
              charge={enCours === 'a'}
              onClick={() => creer.mutate({ chemin: 'a' })}
            />
          </>
        )}
      </div>

      {periode && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="xp-debut">Du</Label>
              <Input id="xp-debut" type="date" value={periode.debut} onChange={(e) => setPeriode({ ...periode, debut: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xp-fin">Au</Label>
              <Input id="xp-fin" type="date" value={periode.fin} onChange={(e) => setPeriode({ ...periode, fin: e.target.value })} />
            </div>
          </div>
          <Button className="w-full" disabled={!periodeValide || enCours === 'xp'} onClick={lancerXP}>
            {enCours === 'xp' && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Faire le rapport
          </Button>
        </div>
      )}
      {message && <p className="text-sm text-destructive text-center">{message}</p>}

      <div className="flex flex-wrap gap-2 pt-2">
        {[['', 'Tous'], ['Z', 'Clôtures Z'], ['X', 'X'], ['XP', 'X périodiques'], ['A', 'Articles']].map(([v, l]) => (
          <button key={v} onClick={() => setType(v)} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${type === v ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            {l}
          </button>
        ))}
      </div>
      {isLoading && <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />}
      {!isLoading && !data?.rapports?.length && <p className="text-sm text-muted-foreground text-center py-8">Aucun rapport pour l’instant.</p>}
      <div className="space-y-2">
        {(data?.rapports ?? []).map((r: any) => (
          <button key={r.id} onClick={() => setOuvert(r.id)} className="w-full text-left rounded-2xl border border-border p-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm">{titreRapport({ type: r.report_type, seq: r.seq })}</span>
              <span className="font-semibold text-sm">
                {r.report_type === 'A' ? `${r.totaux?.articles ?? 0} article(s)` : formatCurrency(r.totaux?.net_cents ?? 0, 'CDF')}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {dateRapport(r.period_start)} → {dateRapport(r.period_end)}
              {r.report_type !== 'A' && ` · ${r.totaux?.factures ?? 0} facture(s)`}
              {r.print_count > 0 && ` · imprimé ${r.print_count} fois`}
            </div>
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={confirmerZ}
        onOpenChange={setConfirmerZ}
        title={`Clôturer la période (Z n° ${data?.prochain_z ?? ''}) ?`}
        description="Le rapport Z ferme la période : il ne peut être ni modifié ni refait. Le prochain rapport X repartira de zéro."
        confirmLabel="Clôturer"
        onConfirm={() => {
          setConfirmerZ(false);
          creer.mutate({ chemin: 'z' });
        }}
      />
      {ouvert && <RapportSheet orgId={orgId} rapport={ouvert} onClose={() => setOuvert(null)} />}
    </div>
  );
}

function Bouton({ icone, titre, texte, onClick, charge, ton }: { icone: React.ReactNode; titre: string; texte: string; onClick: () => void; charge?: boolean; ton?: 'fort' }) {
  return (
    <button
      onClick={onClick}
      disabled={charge}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${
        ton === 'fort' ? 'border-primary/40 bg-primary/5 hover:bg-primary/10' : 'border-border hover:bg-muted/50'
      }`}
    >
      <span className="mt-0.5 text-primary">{charge ? <Loader2 className="w-5 h-5 animate-spin" /> : icone}</span>
      <span>
        <span className="block font-semibold text-sm">{titre}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{texte}</span>
      </span>
    </button>
  );
}

/** Un rapport : aperçu exact de ce qui s'imprime ; la première impression est l'originale, les suivantes DUPLICATA. */
function RapportSheet({ orgId, rapport, onClose }: { orgId: string; rapport: VueRapportFiscal | string; onClose: () => void }) {
  const id = typeof rapport === 'string' ? rapport : rapport.id;
  const cle = ['rapport-fiscal', orgId, id];
  const qc = useQueryClient();
  const { data: vue, isLoading, error } = useQuery<VueRapportFiscal>({
    queryKey: cle,
    initialData: typeof rapport === 'string' ? undefined : rapport,
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/rapports/${id}`)).data,
  });
  const [imprime, setImprime] = useState(false);
  const lines = useMemo(() => (vue ? buildRapportFiscal(vue) : []), [vue]);
  const flow = usePrintFlow();
  const [message, setMessage] = useState<string | null>(null);
  const imprimer = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/facture-normalisee/rapports/${id}/impression`)).data as VueRapportFiscal,
    onSuccess: (v) => {
      setImprime(true);
      qc.setQueryData(cle, { ...v, duplicata: true });
      qc.invalidateQueries({ queryKey: ['rapports-fiscaux', orgId] });
      flow.print(buildRapportFiscal(v), `${titreRapport(v).replace(/[^\wÀ-ÿ]+/g, '-')}`);
    },
    onError: (e) => setMessage(messageErreur(e, 'Impression impossible')),
  });

  return (
    <FormSheet onClose={onClose} title={vue ? titreRapport(vue) : 'Rapport'} size="narrow">
      <div className="p-6 space-y-4">
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
        {error && <p className="text-sm text-destructive text-center">{messageErreur(error, 'Rapport introuvable')}</p>}
        {vue && <ReceiptPreview lines={lines} />}
        <PrintFlowStatus flow={flow} />
        {message && <p className="text-sm text-center text-muted-foreground">{message}</p>}
        {vue && (
          <div className="max-w-sm mx-auto flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => imprimer.mutate()} disabled={imprimer.isPending || flow.printing || flow.picking}>
              {imprimer.isPending || flow.printing ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Printer className="mr-2 w-4 h-4" />}
              {vue.duplicata || imprime ? 'Imprimer un duplicata' : 'Imprimer'}
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Fermer
            </Button>
          </div>
        )}
      </div>
    </FormSheet>
  );
}

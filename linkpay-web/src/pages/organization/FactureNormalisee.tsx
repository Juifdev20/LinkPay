import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Loader2, ShieldAlert, ShieldCheck, Wifi } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RequireOnline } from '@/components/RequireOnline';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FactureNormaliseeSheet } from '@/components/facture-normalisee/FactureNormaliseeSheet';
import { AvoirSheet } from '@/components/facture-normalisee/AvoirSheet';
import { messageErreur, STATUTS, TONS } from '@/components/facture-normalisee/shared';
import { RapportsFiscaux } from '@/components/facture-normalisee/RapportsFiscaux';
import { TestsDgi } from '@/components/facture-normalisee/TestsDgi';
import type { VueFactureNormalisee } from '@/lib/printing/build-facture-normalisee';

/**
 * Facture normalisée (DGI) de l'entreprise : paramètres fiscaux et jeton e-MCF (patron, gérants), activation, journal
 * des factures (impression, duplicata, nouvel essai, avoir). Tout demande le réseau : le serveur de la DGI est en ligne.
 */
type Onglet = 'parametres' | 'factures' | 'rapports' | 'tests';
const LIBELLES_ONGLETS: Record<Onglet, string> = { parametres: 'Paramètres', factures: 'Factures', rapports: 'Rapports X / Z / A', tests: 'Tests DGI' };

export default function FactureNormaliseePage() {
  const { data: org, isLoading } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const [onglet, setOnglet] = useState<Onglet>('parametres');
  const { data: profil } = useQuery({
    queryKey: ['fiscal-profil', org?.id],
    enabled: !!org?.id,
    queryFn: async () => (await api.get(`/organizations/${org.id}/facture-normalisee/profil`)).data,
  });
  const onglets: Onglet[] = profil?.droits === 'gestion' ? ['parametres', 'factures', 'rapports', 'tests'] : ['parametres', 'factures', 'rapports'];
  if (isLoading || !org?.id) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  return (
    <RequireOnline what="La facture normalisée" why="elle parle au serveur de la DGI (e-MCF), qui est en ligne">
      <div className="p-6 space-y-6 w-full max-w-4xl mx-auto">
        <PageHeader title="Facture normalisée (DGI)" />
        <div className="flex flex-wrap gap-2">
          {onglets.map((o) => (
            <button
              key={o}
              onClick={() => setOnglet(o)}
              className={`px-4 py-2 rounded-full text-sm font-semibold ${onglet === o ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
            >
              {LIBELLES_ONGLETS[o]}
            </button>
          ))}
        </div>
        {onglet === 'parametres' && <Parametres orgId={org.id} />}
        {onglet === 'factures' && <Journal orgId={org.id} />}
        {onglet === 'rapports' && <Rapports orgId={org.id} />}
        {onglet === 'tests' && <TestsDgi orgId={org.id} />}
      </div>
    </RequireOnline>
  );
}

function Parametres({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const cle = ['fiscal-profil', orgId];
  const { data, isLoading, error } = useQuery({ queryKey: cle, queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/profil`)).data });
  const { data: etat, refetch: verifier, isFetching: verification } = useQuery({
    queryKey: ['fiscal-etat', orgId],
    enabled: !!data?.profil?.jeton_enregistre,
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/etat`)).data,
  });
  const p = data?.profil;
  const gestion = data?.droits === 'gestion';
  const [form, setForm] = useState({ nif: '', vat_regime: 'non_assujetti', price_mode: 'ttc', default_tax_group: '', trade_name: '', address: '', phone: '', email: '' });
  const [jeton, setJeton] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    if (p)
      setForm({
        nif: p.nif ?? '',
        vat_regime: p.vat_regime,
        price_mode: p.price_mode,
        default_tax_group: p.default_tax_group ?? '',
        trade_name: p.trade_name ?? '',
        address: p.address ?? '',
        phone: p.phone ?? '',
        email: p.email ?? '',
      });
  }, [p?.nif, p?.vat_regime, p?.price_mode, p?.default_tax_group, p?.trade_name, p?.address, p?.phone, p?.email]);

  const ok = (texte: string) => (r: any) => {
    qc.setQueryData(cle, r?.droits ? r : undefined);
    qc.invalidateQueries({ queryKey: cle });
    setMessage({ ok: true, texte });
  };
  const ko = (e: unknown) => setMessage({ ok: false, texte: messageErreur(e) });
  const enregistrer = useMutation({ mutationFn: async () => (await api.put(`/organizations/${orgId}/facture-normalisee/profil`, form)).data, onSuccess: ok('Paramètres enregistrés.'), onError: ko });
  const envoyerJeton = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/facture-normalisee/jeton`, { jeton, environnement: 'test' })).data,
    onSuccess: (r: any) => {
      setJeton('');
      ok(`Jeton accepté par la DGI${r?.nim ? ` (e-MCF ${r.nim})` : ''}.`)(null);
      qc.invalidateQueries({ queryKey: ['fiscal-etat', orgId] });
    },
    onError: ko,
  });
  const activer = useMutation({
    mutationFn: async (actif: boolean) => (await api.post(`/organizations/${orgId}/facture-normalisee/activation`, { actif })).data,
    onSuccess: (r: any) => ok(r?.profil?.enabled ? 'Facture normalisée activée : chaque vente sera normalisée par la DGI.' : 'Facture normalisée désactivée.')(r),
    onError: ko,
  });

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />;
  if (error) return <p className="text-sm text-destructive">{messageErreur(error, 'Réservé au patron et aux gérants')}</p>;
  const champ = (k: keyof typeof form) => ({ value: form[k], onChange: (e: any) => setForm((f) => ({ ...f, [k]: e.target.value })), disabled: !gestion });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {p?.enabled ? <ShieldCheck className="w-5 h-5 text-success" /> : <ShieldAlert className="w-5 h-5 text-warning" />}
            {p?.enabled ? 'Activée : chaque vente devient une facture normalisée' : 'Désactivée'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Une fois activée, chaque vente payée (caisse et Ventes) est envoyée à la DGI, qui renvoie le code de sécurité et le code QR imprimés sur la facture.
            Sans réseau, la vente donne un bon provisoire, normalisé automatiquement au retour du réseau.
          </p>
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <span className="font-medium">Facture normalisée</span>
            <Switch checked={!!p?.enabled} disabled={!gestion || activer.isPending} onCheckedChange={(v) => activer.mutate(v)} />
          </div>
          {p?.emcf_environment !== 'production' && (
            <p className="text-xs text-warning">Mode test DGI : ScanLinkPay est en cours d'homologation. Les factures de test n'ont pas de valeur fiscale.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identité fiscale</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>NIF de l'entreprise</Label>
            <Input {...champ('nif')} maxLength={9} placeholder="A2216742Y" onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Régime TVA</Label>
            <Select {...champ('vat_regime')}>
              <option value="assujetti">Assujetti à la TVA</option>
              <option value="non_assujetti">Non assujetti (groupe K)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Prix unitaires</Label>
            <Select {...champ('price_mode')}>
              <option value="ttc">TTC (toutes taxes comprises)</option>
              <option value="ht">HT (hors taxe)</option>
            </Select>
            <p className="text-[11px] text-muted-foreground">Les ventes de la caisse sont toujours en TTC.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Groupe des produits sans groupe</Label>
            <Select {...champ('default_tax_group')}>
              <option value="">Automatique ({form.vat_regime === 'assujetti' ? 'B — 16 %' : 'K — non-assujetti'})</option>
              {(data?.groupes ?? [])
                .filter((g: any) => g.autorise)
                .map((g: any) => (
                  <option key={g.groupe} value={g.groupe}>
                    {g.groupe} — {g.libelle}
                  </option>
                ))}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Dénomination sur la facture</Label>
            <Input {...champ('trade_name')} placeholder="Nom de l'entreprise" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Adresse</Label>
            <Input {...champ('address')} placeholder="Avenue, commune, ville" />
          </div>
          <div className="space-y-1.5">
            <Label>Téléphone</Label>
            <Input {...champ('phone')} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input {...champ('email')} type="email" />
          </div>
          {gestion && (
            <Button className="sm:col-span-2" onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
              {enregistrer.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Enregistrer
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-5 h-5" /> Jeton e-MCF (DGI)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {p?.jeton_enregistre ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
              <span>
                Jeton enregistré <span className="text-muted-foreground">(…{p.jeton_indice})</span>
                {etat?.connecte && etat?.nim ? ` · e-MCF ${etat.nim}` : ''}
              </span>
              <button onClick={() => verifier()} className="text-primary text-xs font-semibold flex items-center gap-1">
                {verification ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Vérifier
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground">Aucun jeton. Créez-le sur le portail e-DEF de la DGI (« Gestion des jetons e-MCF »), puis collez-le ici.</p>
          )}
          {etat && (
            <p className={etat.connecte ? 'text-success flex items-center gap-1.5' : 'text-destructive'}>
              {etat.connecte ? <CheckCircle2 className="w-4 h-4" /> : null}
              {etat.connecte
                ? `Connecté à la DGI${etat.valide_jusqu_au ? ` · jeton valable jusqu'au ${formatDate(etat.valide_jusqu_au)}` : ''}${etat.en_attente ? ` · ${etat.en_attente} demande(s) en attente` : ''}`
                : etat.message}
            </p>
          )}
          {gestion && (
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" placeholder="Coller le jeton e-MCF" value={jeton} onChange={(e) => setJeton(e.target.value)} />
              <Button onClick={() => envoyerJeton.mutate()} disabled={jeton.trim().length < 20 || envoyerJeton.isPending}>
                {envoyerJeton.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Le jeton est essayé auprès de la DGI puis gardé chiffré ; il n'est plus jamais affiché. Ne l'envoyez à personne.</p>
        </CardContent>
      </Card>

      {message && <p className={`text-sm text-center ${message.ok ? 'text-success' : 'text-destructive'}`}>{message.texte}</p>}
    </div>
  );
}

function Rapports({ orgId }: { orgId: string }) {
  const { data: profil } = useQuery({ queryKey: ['fiscal-profil', orgId], queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/profil`)).data });
  return <RapportsFiscaux orgId={orgId} gestion={profil?.droits === 'gestion'} />;
}

function Journal({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [statut, setStatut] = useState<string>('');
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [avoirSur, setAvoirSur] = useState<VueFactureNormalisee | null>(null);
  const { data: profil } = useQuery({ queryKey: ['fiscal-profil', orgId], queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/profil`)).data });
  const { data, isLoading } = useQuery({
    queryKey: ['factures-normalisees', orgId, statut],
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/factures`, { params: { status: statut || undefined } })).data,
  });
  const gestion = profil?.droits === 'gestion';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[['', 'Toutes'], ['confirmed', 'Normalisées'], ['provisional', 'Bons provisoires'], ['failed', 'À traiter']].map(([v, l]) => (
          <button key={v} onClick={() => setStatut(v)} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${statut === v ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            {l}
          </button>
        ))}
      </div>
      {isLoading && <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />}
      {!isLoading && !data?.factures?.length && <p className="text-sm text-muted-foreground text-center py-8">Aucune facture.</p>}
      <div className="space-y-2">
        {(data?.factures ?? []).map((f: any) => {
          const s = STATUTS[f.status] ?? STATUTS.abandoned;
          return (
            <button key={f.id} onClick={() => setOuverte(f.id)} className="w-full text-left rounded-2xl border border-border p-3 hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">
                  {f.rn} {['FA', 'EA'].includes(f.invoice_type) && <span className="text-destructive">· avoir</span>}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TONS[s.ton]}`}>{s.libelle}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mt-1">
                <span className="truncate">
                  {formatDate(f.created_at)} · {f.client?.nom || 'Particulier'} · {f.operator_name}
                </span>
                <span className="font-semibold text-foreground">{f.total_cents ? formatCurrency(f.total_cents, 'CDF') : '—'}</span>
              </div>
              {f.status === 'failed' && f.last_error_desc && <p className="text-[11px] text-destructive mt-1 line-clamp-2">{f.last_error_desc}</p>}
            </button>
          );
        })}
      </div>

      {ouverte && (
        <FactureNormaliseeSheet
          orgId={orgId}
          factureId={ouverte}
          onClose={() => setOuverte(null)}
          onAvoir={gestion ? (vue) => { setOuverte(null); setAvoirSur(vue); } : undefined}
        />
      )}
      {avoirSur && (
        <AvoirSheet
          orgId={orgId}
          origine={avoirSur}
          onClose={() => setAvoirSur(null)}
          onDone={(a: any) => {
            setAvoirSur(null);
            qc.invalidateQueries({ queryKey: ['factures-normalisees', orgId] });
            setOuverte(a.id);
          }}
        />
      )}
    </div>
  );
}

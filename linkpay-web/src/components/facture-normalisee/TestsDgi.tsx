import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Download, ExternalLink, FileText, Loader2, Play, Square, XCircle, AlertTriangle, MinusCircle } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { FactureNormaliseeSheet } from './FactureNormaliseeSheet';
import { messageErreur } from './shared';

/**
 * Cas de test de l'homologation DGI (document « Cas de test SFE » v1.2), rejoués sur l'e-MCF de TEST : chaque cas devient
 * une facture normalisée de test, à imprimer, photographier et vérifier sur le site de vérification de la DGI. Une
 * « campagne » = une série complète ; on la fait en TTC puis en HT. Un cas réussi n'est jamais refait.
 */
type Mode = 'ttc' | 'ht';
type Etat = 'a_faire' | 'reussi' | 'echec' | 'a_verifier' | 'en_attente' | 'hors_perimetre';

interface Cas {
  num: number;
  titre: string;
  type: string;
  type_libelle: string;
  client: string;
  articles: string;
  a_verifier: string;
  origine: number | null;
  avoir: boolean;
  hors_perimetre: string | null;
}

interface Resultat {
  num: number;
  mode: Mode;
  etat: Etat;
  facture: { id: string; rn: string; status: string; total_cents: number | null; vat_cents: number | null; code_def_dgi: string | null; emcf_datetime: string | null; last_error_desc: string | null } | null;
  message?: string;
}

const ETATS: Record<Etat, { libelle: string; classe: string; icone: JSX.Element }> = {
  reussi: { libelle: 'Réussi', classe: 'bg-success/10 text-success', icone: <CheckCircle2 className="w-4 h-4" /> },
  echec: { libelle: 'Échec', classe: 'bg-destructive/10 text-destructive', icone: <XCircle className="w-4 h-4" /> },
  a_verifier: { libelle: 'À vérifier', classe: 'bg-warning/10 text-warning', icone: <AlertTriangle className="w-4 h-4" /> },
  en_attente: { libelle: 'En attente', classe: 'bg-warning/10 text-warning', icone: <CircleDashed className="w-4 h-4" /> },
  a_faire: { libelle: 'À faire', classe: 'bg-muted text-muted-foreground', icone: <CircleDashed className="w-4 h-4" /> },
  hors_perimetre: { libelle: 'Hors périmètre', classe: 'bg-muted text-muted-foreground', icone: <MinusCircle className="w-4 h-4" /> },
};

const VERIFICATION_DGI = 'https://developper.dgirdc.cd/sygdef/verification';
const nouvelleCampagne = () => {
  const d = new Date(Date.now() + 3600_000); // heure de Kinshasa
  return d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
};

export function TestsDgi({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data: etat, isLoading, error } = useQuery({
    queryKey: ['tests-dgi', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/tests-dgi`)).data,
  });
  const [campagne, setCampagne] = useState<string>('');
  const [mode, setMode] = useState<Mode>('ttc');
  const [pin, setPin] = useState('');
  const [clients, setClients] = useState({ nif: '', nomPM: '', nomPC: '', nomPL: '' });
  const [enCours, setEnCours] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const arret = useRef(false);

  useEffect(() => {
    if (etat && !campagne) setCampagne(etat.campagnes?.[0]?.campagne ?? nouvelleCampagne());
    if (etat?.nif && !clients.nif) setClients((c) => ({ ...c, nif: etat.nif }));
  }, [etat, campagne, clients.nif]);

  const cleResultats = ['tests-dgi-resultats', orgId, campagne];
  const { data: res } = useQuery<{ resultats: Resultat[] }>({
    queryKey: cleResultats,
    enabled: !!campagne,
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/tests-dgi/campagnes/${campagne}`)).data,
  });
  const resultats = useMemo(() => new Map((res?.resultats ?? []).filter((r) => r.mode === mode).map((r) => [r.num, r])), [res, mode]);
  const cas: Cas[] = etat?.cas ?? [];
  const aFaire = cas.filter((c) => !c.hors_perimetre && resultats.get(c.num)?.etat !== 'reussi' && resultats.get(c.num)?.etat !== 'a_verifier');
  const reussis = cas.filter((c) => resultats.get(c.num)?.etat === 'reussi').length;
  const perimetre = cas.filter((c) => !c.hors_perimetre).length;
  const pinRequis = aFaire.some((c) => c.avoir);

  const majResultat = (r: Resultat) =>
    qc.setQueryData(cleResultats, (old: any) => ({
      ...(old ?? { campagne }),
      resultats: [...(old?.resultats ?? []).filter((x: Resultat) => !(x.num === r.num && x.mode === r.mode)), r],
    }));

  const jouer = async (c: Cas): Promise<boolean> => {
    setEnCours(c.num);
    try {
      const r = (
        await api.post(`/organizations/${orgId}/facture-normalisee/tests-dgi/jouer`, {
          campagne,
          mode,
          num: c.num,
          pin: c.avoir ? pin || undefined : undefined,
          clients: { nif: clients.nif || undefined, nomPM: clients.nomPM || undefined, nomPC: clients.nomPC || undefined, nomPL: clients.nomPL || undefined },
        })
      ).data as Resultat;
      majResultat(r);
      return r.etat === 'reussi';
    } catch (e) {
      majResultat({ num: c.num, mode, etat: 'echec', facture: resultats.get(c.num)?.facture ?? null, message: messageErreur(e, 'Échec') });
      return false;
    } finally {
      setEnCours(null);
    }
  };

  const toutLancer = async () => {
    if (pinRequis && !/^\d{4,6}$/.test(pin)) {
      setMessage('Les avoirs (cas 10 à 13, 16) demandent votre code PIN : saisissez-le avant de lancer.');
      return;
    }
    setMessage(null);
    arret.current = false;
    let echecs = 0;
    for (const c of aFaire) {
      if (arret.current) break;
      const ok = await jouer(c);
      if (!ok) echecs += 1;
    }
    qc.invalidateQueries({ queryKey: ['tests-dgi', orgId] });
    qc.invalidateQueries({ queryKey: cleResultats });
    setMessage(arret.current ? 'Arrêté.' : echecs ? `${echecs} cas en échec : ouvrez-les pour voir pourquoi, puis relancez.` : `Tous les cas en ${mode.toUpperCase()} sont passés.`);
  };

  const exporter = () => {
    const lignes = [['Cas', 'Mode', 'Titre', 'Statut', 'N° facture', 'Code DEF/DGI', 'Total CDF', 'TVA CDF', 'Date DGI', 'Message']];
    for (const r of [...(res?.resultats ?? [])].sort((a, b) => (a.mode === b.mode ? a.num - b.num : a.mode === 'ttc' ? -1 : 1))) {
      const c = cas.find((x) => x.num === r.num);
      lignes.push([
        String(r.num),
        r.mode.toUpperCase(),
        c?.titre ?? '',
        ETATS[r.etat].libelle,
        r.facture?.rn ?? '',
        r.facture?.code_def_dgi ?? '',
        r.facture?.total_cents != null ? (r.facture.total_cents / 100).toFixed(2) : '',
        r.facture?.vat_cents != null ? (r.facture.vat_cents / 100).toFixed(2) : '',
        r.facture?.emcf_datetime ?? '',
        c?.hors_perimetre ?? r.message ?? '',
      ]);
    }
    const csv = '﻿' + lignes.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    lien.download = `tests-dgi-${campagne}.csv`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  };

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />;
  if (error) return <p className="text-sm text-destructive text-center">{messageErreur(error, 'Tests DGI indisponibles')}</p>;

  return (
    <div className="space-y-4">
      {etat.pret ? (
        <div className="flex items-start gap-2 rounded-xl p-3 text-sm bg-success/10 text-success">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Prêt : e-MCF de TEST, NIF {etat.nif}. Groupes déclarés : {etat.groupes.join(', ')}.</span>
        </div>
      ) : (
        <div className="rounded-xl p-3 text-sm bg-warning/10 text-warning space-y-1">
          <p className="font-semibold">Avant de lancer les tests :</p>
          <ul className="list-disc pl-5">
            {etat.manque.map((m: string) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="campagne">Campagne</Label>
          <div className="flex gap-2">
            <Select id="campagne" value={campagne} onChange={(e) => setCampagne(e.target.value)} className="flex-1">
              {!etat.campagnes.some((c: any) => c.campagne === campagne) && campagne && <option value={campagne}>{campagne} (nouvelle)</option>}
              {etat.campagnes.map((c: any) => (
                <option key={c.campagne} value={c.campagne}>
                  {c.campagne} ({c.factures})
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => setCampagne(nouvelleCampagne())} disabled={enCours !== null}>
              Nouvelle
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Mode des prix</Label>
          <div className="flex gap-2">
            {(['ttc', 'ht'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={enCours !== null}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold ${mode === m ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="rounded-2xl border border-border p-3">
        <summary className="text-sm font-semibold cursor-pointer">Clients de test (NIF et noms)</summary>
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-nif">NIF des clients PM, PC, PL</Label>
            <Input id="t-nif" maxLength={9} value={clients.nif} onChange={(e) => setClients({ ...clients, nif: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-pm">Personne morale</Label>
            <Input id="t-pm" placeholder="CLIENT TEST SARL" value={clients.nomPM} onChange={(e) => setClients({ ...clients, nomPM: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-pc">Commerçant</Label>
            <Input id="t-pc" placeholder="COMMERÇANT TEST" value={clients.nomPC} onChange={(e) => setClients({ ...clients, nomPC: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-pl">Profession libérale</Label>
            <Input id="t-pl" placeholder="CABINET TEST" value={clients.nomPL} onChange={(e) => setClients({ ...clients, nomPL: e.target.value })} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Par défaut, le NIF de votre entreprise : l’e-MCF de test le connaît.</p>
      </details>

      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">
            {mode.toUpperCase()} : {reussis} / {perimetre} réussis
          </span>
          <span className="text-muted-foreground">{cas.length - perimetre} hors périmètre</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-success transition-all" style={{ width: `${perimetre ? (reussis / perimetre) * 100 : 0}%` }} />
        </div>
        {pinRequis && (
          <div className="space-y-1.5">
            <Label htmlFor="t-pin">Code PIN (pour les avoirs)</Label>
            <Input id="t-pin" name="tests-dgi-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" data-lpignore="true" data-1p-ignore value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {enCours === null ? (
            <Button onClick={toutLancer} disabled={!etat.pret || !aFaire.length}>
              <Play className="mr-2 w-4 h-4" /> {aFaire.length ? `Lancer les ${aFaire.length} cas restants` : 'Tout est fait'}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => (arret.current = true)}>
              <Square className="mr-2 w-4 h-4" /> Arrêter après le cas n° {enCours}
            </Button>
          )}
          <Button variant="outline" onClick={exporter} disabled={!res?.resultats?.some((r) => r.facture)}>
            <Download className="mr-2 w-4 h-4" /> Récapitulatif (tableur)
          </Button>
          <a href={VERIFICATION_DGI} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline px-2">
            <ExternalLink className="w-4 h-4" /> Site de vérification DGI
          </a>
        </div>
        {message && <p className="text-sm">{message}</p>}
      </div>

      <div className="space-y-2">
        {cas.map((c) => {
          const r = resultats.get(c.num);
          const e = ETATS[c.hors_perimetre ? 'hors_perimetre' : r?.etat ?? 'a_faire'];
          return (
            <div key={c.num} className={`rounded-2xl border border-border p-3 ${c.hors_perimetre ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    #{c.num} · {c.titre}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.type} · client {c.client} · {c.articles}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${e.classe}`}>
                  {enCours === c.num ? <Loader2 className="w-4 h-4 animate-spin" /> : e.icone} {e.libelle}
                </span>
              </div>
              {c.hors_perimetre ? (
                <p className="text-[11px] text-muted-foreground mt-1">{c.hors_perimetre} à l’homologation : ce cas n’est pas demandé.</p>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground mt-1">À vérifier sur la photo : {c.a_verifier}.</p>
                  {r?.facture && (
                    <p className="text-xs mt-1">
                      N° {r.facture.rn}
                      {r.facture.total_cents != null && ` · ${formatCurrency(r.facture.total_cents, 'CDF')}`}
                      {r.facture.code_def_dgi && <span className="text-muted-foreground"> · {r.facture.code_def_dgi}</span>}
                    </p>
                  )}
                  {r && r.etat !== 'reussi' && (r.message || r.facture?.last_error_desc) && (
                    <p className="text-[11px] text-destructive mt-1">{r.message || r.facture?.last_error_desc}</p>
                  )}
                  <div className="flex gap-3 mt-2">
                    {r?.etat !== 'reussi' && r?.etat !== 'a_verifier' && (
                      <button
                        className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                        disabled={!etat.pret || enCours !== null || (c.avoir && !/^\d{4,6}$/.test(pin))}
                        onClick={() => jouer(c)}
                      >
                        {r?.facture ? 'Réessayer' : 'Jouer ce cas'}
                        {c.avoir && !/^\d{4,6}$/.test(pin) && ' (code PIN demandé)'}
                      </button>
                    )}
                    {r?.facture && (
                      <button className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setOuverte(r.facture!.id)}>
                        <FileText className="w-3.5 h-3.5" /> Voir et imprimer
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border p-3 text-sm space-y-1">
        <p className="font-semibold">Rapports (R01 à R03)</p>
        <p className="text-muted-foreground text-xs">
          Une fois les factures faites, ouvrez l’onglet « Rapports X / Z / A » : faites un rapport X, puis la clôture Z, puis un rapport A, et
          photographiez-les pour le dossier.
        </p>
      </div>

      {ouverte && <FactureNormaliseeSheet orgId={orgId} factureId={ouverte} onClose={() => setOuverte(null)} />}
    </div>
  );
}

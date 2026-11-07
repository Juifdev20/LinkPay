import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FilePlus2, Loader2, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormSheet } from '@/components/FormSheet';
import { PinInput } from '@/components/PinInput';
import { formatCurrency } from '@/lib/utils';
import { ClientFiscalForm } from './ClientFiscalForm';
import { GROUPES_PRODUIT } from './ChampsFiscauxProduit';
import { erreurClient, messageErreur, type ClientFiscal } from './shared';

/**
 * Factures « spéciales » (patron, gérant) : celles qui ne naissent pas d'une vente à la caisse — facture d'acompte,
 * vente ou acompte à l'exportation, remise / ristourne / rabais (avoir sans facture d'origine, avec le code PIN).
 * Le serveur applique les mêmes contrôles et le même calcul que pour une vente ; le total du paiement est calculé par lui.
 */
type Genre = 'FT' | 'EV' | 'ET' | 'RRR';

const GENRES: { code: Genre; libelle: string; aide: string }[] = [
  { code: 'FT', libelle: 'Acompte', aide: "Facture d'acompte ou d'avance, avant la livraison." },
  { code: 'EV', libelle: 'Exportation', aide: "Vente à l'exportation (groupe E, 0 %)." },
  { code: 'ET', libelle: 'Acompte export', aide: "Facture d'acompte pour une vente à l'exportation." },
  { code: 'RRR', libelle: 'Remise', aide: "Remise, ristourne ou rabais après la vente : un avoir sans facture d'origine. Votre code PIN est demandé." },
];

const MOYENS = [
  ['ESPECES', 'Espèces'],
  ['VIREMENT', 'Virement'],
  ['MOBILEMONEY', 'Mobile Money'],
  ['CARTEBANCAIRE', 'Carte bancaire'],
  ['CHEQUES', 'Chèque'],
  ['CREDIT', 'Crédit'],
] as const;

interface Ligne {
  nom: string;
  groupe: string;
  type: 'BIE' | 'SER';
  quantite: string;
  prix: string;
}

const enCentimes = (prix: string) => {
  const n = Number(prix.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const quantiteValide = (q: string) => /^\d+([.,]\d{1,3})?$/.test(q.trim()) && Number(q.replace(',', '.')) > 0;

export function FactureSpecialeSheet({
  orgId,
  groupesAutorises,
  modePrix,
  onClose,
  onDone,
}: {
  orgId: string;
  groupesAutorises: string[];
  modePrix: 'ttc' | 'ht';
  onClose: () => void;
  onDone: (facture: any) => void;
}) {
  const [genre, setGenre] = useState<Genre>('FT');
  const [client, setClient] = useState<ClientFiscal>({ type: 'PM' });
  const [moyen, setMoyen] = useState<(typeof MOYENS)[number][0]>('VIREMENT');
  const [etape, setEtape] = useState<'saisie' | 'pin'>('saisie');
  const [pin, setPin] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const export_ = genre === 'EV' || genre === 'ET';
  // Le groupe E est réservé aux factures d'exportation ; les autres groupes servent partout.
  const groupes = useMemo(
    () => GROUPES_PRODUIT.filter((g) => groupesAutorises.includes(g.groupe) && (export_ || g.groupe !== 'E')),
    [groupesAutorises, export_],
  );
  const groupeParDefaut = export_ && groupes.some((g) => g.groupe === 'E') ? 'E' : groupes[0]?.groupe ?? 'B';
  const nouvelleLigne = (): Ligne => ({ nom: '', groupe: groupeParDefaut, type: 'BIE', quantite: '1', prix: '' });
  const [lignes, setLignes] = useState<Ligne[]>(() => [nouvelleLigne()]);

  const changerGenre = (g: Genre) => {
    setGenre(g);
    const exp = g === 'EV' || g === 'ET';
    // On remet un groupe permis aux lignes dont le groupe ne l'est plus (E hors exportation).
    setLignes((ls) =>
      ls.map((l) => {
        const permis = GROUPES_PRODUIT.some((x) => groupesAutorises.includes(x.groupe) && x.groupe === l.groupe && (exp || x.groupe !== 'E'));
        const defaut = exp && groupesAutorises.includes('E') ? 'E' : GROUPES_PRODUIT.find((x) => groupesAutorises.includes(x.groupe) && x.groupe !== 'E')?.groupe ?? 'B';
        return permis ? l : { ...l, groupe: defaut };
      }),
    );
  };
  const maj = (i: number, champ: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...champ } : l)));

  const sommeLignes = lignes.reduce((s, l) => s + Math.round(enCentimes(l.prix) * (quantiteValide(l.quantite) ? Number(l.quantite.replace(',', '.')) : 0)), 0);
  const probleme =
    erreurClient(client) ??
    (lignes.some((l) => !l.nom.trim()) ? 'Donnez un nom à chaque article' : null) ??
    (lignes.some((l) => !enCentimes(l.prix)) ? 'Le prix de chaque article doit être supérieur à zéro' : null) ??
    (lignes.some((l) => !quantiteValide(l.quantite)) ? 'La quantité doit être supérieure à zéro (3 décimales au plus)' : null);

  const envoyer = useMutation({
    mutationFn: async (code?: string) =>
      (
        await api.post(`/organizations/${orgId}/facture-normalisee/factures/manuelle`, {
          type: genre === 'RRR' ? 'FA' : genre,
          nature_avoir: genre === 'RRR' ? 'RRR' : undefined,
          pin: genre === 'RRR' ? code : undefined,
          client,
          moyen_paiement: moyen,
          articles: lignes.map((l) => ({
            nom: l.nom.trim(),
            type: l.type,
            groupe: l.groupe,
            prixUnitaireCents: enCentimes(l.prix),
            quantite: l.quantite.trim().replace(',', '.'),
          })),
        })
      ).data,
    onSuccess: onDone,
    onError: (e) => {
      setPin('');
      setEtape('saisie');
      setErreur(messageErreur(e, "La facture n'a pas pu être émise"));
    },
  });

  if (etape === 'pin') {
    return (
      <FormSheet onClose={onClose} title="Confirmer la remise" size="narrow">
        <div className="p-6">
          <PinInput
            value={pin}
            onChange={(v) => {
              setPin(v);
              if (v.length === 4) envoyer.mutate(v);
            }}
            title="Votre code PIN"
            hint="Remise, ristourne ou rabais (avoir)"
            message={envoyer.isPending ? 'Envoi à la DGI…' : undefined}
            onCancel={() => setEtape('saisie')}
            autoFocus
          />
        </div>
      </FormSheet>
    );
  }

  return (
    <FormSheet onClose={onClose} title="Facture spéciale" size="narrow">
      <div className="p-6 space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-semibold">Type de facture</p>
          <div className="grid grid-cols-2 gap-2">
            {GENRES.map((g) => (
              <button
                key={g.code}
                type="button"
                onClick={() => changerGenre(g.code)}
                className={`rounded-xl border p-2 text-xs font-semibold ${genre === g.code ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
              >
                {g.libelle}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{GENRES.find((g) => g.code === genre)?.aide}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Client</p>
          <ClientFiscalForm value={client} onChange={setClient} />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold">{genre === 'RRR' ? 'Montants de la remise' : 'Articles'}</p>
          {lignes.map((l, i) => (
            <div key={i} className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex gap-2">
                <Input
                  aria-label={`Nom de l'article ${i + 1}`}
                  placeholder={genre === 'RRR' ? 'Ex. Remise 10 % sur la facture' : "Nom de l'article ou du service"}
                  value={l.nom}
                  maxLength={200}
                  onChange={(e) => maj(i, { nom: e.target.value })}
                />
                {lignes.length > 1 && (
                  <button type="button" aria-label="Retirer l'article" className="p-2 rounded-lg border text-muted-foreground" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Groupe de taxation</Label>
                  <Select aria-label="Groupe de taxation" value={l.groupe} onChange={(e) => maj(i, { groupe: e.target.value })}>
                    {groupes.map((g) => (
                      <option key={g.groupe} value={g.groupe}>
                        {g.libelle}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select aria-label="Type d'article" value={l.type} onChange={(e) => maj(i, { type: e.target.value as 'BIE' | 'SER' })}>
                    <option value="BIE">Bien</option>
                    <option value="SER">Service</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quantité</Label>
                  <Input aria-label="Quantité" inputMode="decimal" value={l.quantite} onChange={(e) => maj(i, { quantite: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Prix unitaire ({modePrix === 'ttc' ? 'TTC' : 'HT'}, en CDF)</Label>
                  <Input aria-label="Prix unitaire" inputMode="decimal" placeholder="0" value={l.prix} onChange={(e) => maj(i, { prix: e.target.value })} />
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" className="w-full" onClick={() => setLignes((ls) => [...ls, nouvelleLigne()])} disabled={lignes.length >= 50}>
            <Plus className="mr-2 w-4 h-4" /> Ajouter une ligne
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="moyen-speciale">{genre === 'RRR' ? 'Moyen de remboursement' : 'Moyen de paiement'}</Label>
          <Select id="moyen-speciale" value={moyen} onChange={(e) => setMoyen(e.target.value as typeof moyen)}>
            {MOYENS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>

        <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
          <div className="flex items-center justify-between text-sm font-semibold text-foreground">
            <span>{modePrix === 'ttc' ? 'Total des lignes' : 'Total HT des lignes'}</span>
            <span>{formatCurrency(sommeLignes, 'CDF')}</span>
          </div>
          <p>
            {modePrix === 'ttc'
              ? 'Le total de la facture est celui-ci : la TVA est comprise dans les prix.'
              : 'La TVA s\'ajoute à ce total : le montant final est calculé par le serveur et contrôlé par la DGI.'}{' '}
            Le paiement enregistré est égal au total de la facture.
          </p>
        </div>

        {(erreur || (probleme && lignes.some((l) => l.nom || l.prix))) && <p className="text-sm text-destructive">{erreur ?? probleme}</p>}

        <Button
          className="w-full"
          disabled={!!probleme || envoyer.isPending}
          onClick={() => {
            setErreur(null);
            if (genre === 'RRR') setEtape('pin');
            else envoyer.mutate(undefined);
          }}
        >
          {envoyer.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <FilePlus2 className="mr-2 w-4 h-4" />}
          Émettre la facture
        </Button>
      </div>
    </FormSheet>
  );
}

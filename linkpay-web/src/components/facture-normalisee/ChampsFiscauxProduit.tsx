import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/** Groupes déclarés à l'homologation de ScanLinkPay (DECISIONS.md, 03/11/2026). */
export const GROUPES_PRODUIT = [
  { groupe: 'B', libelle: 'B — Taxable 16 %' },
  { groupe: 'C', libelle: 'C — Taxable 5 % (taux réduit)' },
  { groupe: 'O', libelle: 'O — Taxable 1 % (taux réduit 2026)' },
  { groupe: 'A', libelle: 'A — Exonéré / hors champ' },
  { groupe: 'H', libelle: "H — Consignation d'emballage (casiers, bouteilles)" },
  { groupe: 'K', libelle: 'K — Entreprise non assujettie' },
  { groupe: 'E', libelle: 'E — Exportation' },
];

export interface ValeursFiscales {
  tax_group: string;
  dgi_item_type: string;
  dgi_item_code: string;
  specific_tax: string;
  unit_of_measure: string;
}

/** La facture normalisée est-elle active pour l'entreprise de ce magasin ? (lisible par tout vendeur ou magasinier) */
export function useFactureNormaliseeActive(merchantId?: string | null) {
  const { data } = useQuery<{ active: boolean }>({
    queryKey: ['facture-normalisee-active', merchantId],
    enabled: !!merchantId,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await api.get(`/merchants/${merchantId}/facture-normalisee/vente`, { params: { source_type: 'pos_ticket', source_id: '' } })).data,
  });
  return !!data?.active;
}

/** Ce que la DGI demande pour chaque article : groupe de taxation, type, code, taxe spécifique, unité. */
export function ChampsFiscauxProduit({ valeurs, onChange }: { valeurs: ValeursFiscales; onChange: (champ: keyof ValeursFiscales, v: string) => void }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <p className="text-sm font-semibold">Facture normalisée (DGI)</p>
      <div className="space-y-1.5">
        <Label htmlFor="dgi_groupe">Groupe de taxation</Label>
        <Select id="dgi_groupe" value={valeurs.tax_group} onChange={(e) => onChange('tax_group', e.target.value)}>
          <option value="">Celui de la catégorie, sinon le groupe par défaut</option>
          {GROUPES_PRODUIT.map((g) => (
            <option key={g.groupe} value={g.groupe}>
              {g.libelle}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="dgi_type">Type</Label>
          <Select id="dgi_type" value={valeurs.dgi_item_type} onChange={(e) => onChange('dgi_item_type', e.target.value)}>
            <option value="BIE">Bien</option>
            <option value="SER">Service</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dgi_unite">Unité</Label>
          <Input id="dgi_unite" placeholder="kg, pièce, litre…" value={valeurs.unit_of_measure} maxLength={20} onChange={(e) => onChange('unit_of_measure', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="dgi_code">Code DGI <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
          <Input id="dgi_code" placeholder="Défaut : code-barres" value={valeurs.dgi_item_code} maxLength={50} onChange={(e) => onChange('dgi_item_code', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dgi_ts">Taxe spécifique / unité</Label>
          <Input id="dgi_ts" type="number" inputMode="decimal" min={0} placeholder="0" value={valeurs.specific_tax} onChange={(e) => onChange('specific_tax', e.target.value)} />
        </div>
      </div>
      {valeurs.tax_group === 'A' && (
        <p className="text-[11px] text-muted-foreground">Opération hors champ de la TVA : écrivez « HORS CHAMP » dans le code DGI.</p>
      )}
    </div>
  );
}

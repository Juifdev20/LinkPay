import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { getCategoryLabel, getSectorConfig } from '@/lib/stock-categories';
import { GROUPES_PRODUIT } from './ChampsFiscauxProduit';
import { messageErreur } from './shared';

/**
 * Un groupe de taxation par catégorie de produits : « Boissons → B », « Fruits & légumes → A »… réglé une seule fois.
 * À la facturation, le groupe d'un article est : celui de sa fiche produit s'il en a un, sinon celui de sa catégorie,
 * sinon le groupe par défaut de l'entreprise. Rien n'est modifié sur les produits.
 */
interface Ligne {
  category: string;
  produits: number;
  groupe: string | null;
}

export function GroupesParCategorie({ orgId, secteur, gestion }: { orgId: string; secteur?: string | null; gestion: boolean }) {
  const qc = useQueryClient();
  const cle = ['fiscal-categories', orgId];
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const { data, isLoading } = useQuery<{ categories: Ligne[]; groupes_autorises: string[]; groupe_par_defaut: string | null }>({
    queryKey: cle,
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/categories`)).data,
  });

  // Les catégories du secteur (même sans produit encore) + celles que les produits utilisent déjà.
  const lignes = useMemo(() => {
    const parCategorie = new Map<string, Ligne>();
    for (const c of getSectorConfig(secteur).categories) parCategorie.set(c.value, { category: c.value, produits: 0, groupe: null });
    for (const l of data?.categories ?? []) parCategorie.set(l.category, l);
    return [...parCategorie.values()];
  }, [data, secteur]);

  const regler = useMutation({
    mutationFn: async ({ category, groupe }: { category: string; groupe: string | null }) =>
      (await api.put(`/organizations/${orgId}/facture-normalisee/categories`, { categorie: category, groupe })).data,
    onSuccess: (r, v) => {
      qc.setQueryData(cle, r);
      setMessage({ ok: true, texte: v.groupe ? `${getCategoryLabel(v.category)} : groupe ${v.groupe} enregistré.` : `${getCategoryLabel(v.category)} : groupe retiré.` });
    },
    onError: (e) => setMessage({ ok: false, texte: messageErreur(e, 'Enregistrement impossible') }),
  });

  const autorises = GROUPES_PRODUIT.filter((g) => !data || data.groupes_autorises.includes(g.groupe));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Groupe de taxation par catégorie</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Choisissez le groupe de chaque catégorie de produits (par exemple Boissons : B, Fruits &amp; légumes : A). Un produit sans groupe propre prend celui de sa
          catégorie ; sans réglage, il prend le groupe par défaut de l'entreprise{data?.groupe_par_defaut ? ` (${data.groupe_par_defaut})` : ''}. Un produit qui a son
          propre groupe garde le sien. Le bon groupe de chaque produit reste de la responsabilité de l'entreprise.
        </p>
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" />}
        <div className="divide-y divide-border">
          {lignes.map((l) => (
            <div key={l.category} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{getCategoryLabel(l.category)}</p>
                <p className="text-xs text-muted-foreground">{l.produits === 0 ? 'Aucun produit pour le moment' : `${l.produits} produit${l.produits > 1 ? 's' : ''}`}</p>
              </div>
              <div className="w-52 shrink-0">
              <Select
                aria-label={`Groupe de la catégorie ${getCategoryLabel(l.category)}`}
                value={l.groupe ?? ''}
                disabled={!gestion || regler.isPending}
                onChange={(e) => regler.mutate({ category: l.category, groupe: e.target.value || null })}
              >
                <option value="">Groupe par défaut</option>
                {autorises.map((g) => (
                  <option key={g.groupe} value={g.groupe}>
                    {g.libelle}
                  </option>
                ))}
              </Select>
              </div>
            </div>
          ))}
        </div>
        {message && (
          <p className={`text-xs flex items-center gap-1.5 ${message.ok ? 'text-success' : 'text-destructive'}`}>
            {message.ok && <CheckCircle2 className="w-3.5 h-3.5" />} {message.texte}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

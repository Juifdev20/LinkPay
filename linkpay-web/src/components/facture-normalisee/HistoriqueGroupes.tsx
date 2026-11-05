import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCategoryLabel } from '@/lib/stock-categories';

/**
 * Journal des changements de groupe de taxation : qui a changé quoi, quand, de quel groupe à quel groupe. Lecture seule :
 * le serveur ne permet ni de modifier ni d'effacer une ligne.
 */
interface Ligne {
  id: string;
  portee: 'product' | 'category' | 'default';
  sujet: string | null;
  ancien: string | null;
  nouveau: string | null;
  par: string;
  le: string;
}

const TAILLE = 20;
const quand = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const groupe = (g: string | null) => (g ? `Groupe ${g}` : 'Aucun');

function Sujet({ l }: { l: Ligne }) {
  if (l.portee === 'default') return <>Groupe par défaut de l'entreprise</>;
  if (l.portee === 'category') return <>Catégorie « {getCategoryLabel(l.sujet ?? '')} »</>;
  return <>Produit « {l.sujet ?? 'sans nom'} »</>;
}

export function HistoriqueGroupes({ orgId }: { orgId: string }) {
  const [nombre, setNombre] = useState(TAILLE);
  const { data, isLoading, isError } = useQuery<{ total: number; lignes: Ligne[] }>({
    queryKey: ['fiscal-historique-groupes', orgId, nombre],
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/historique-groupes`, { params: { limite: nombre } })).data,
    refetchOnMount: 'always',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historique des changements de groupe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Chaque changement de groupe de taxation (produit, catégorie ou groupe par défaut) est noté ici avec la personne et la date. Cette liste ne peut être ni
          modifiée ni effacée.
        </p>
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" />}
        {isError && <p className="text-xs text-destructive">Impossible de charger l'historique.</p>}
        {data && data.lignes.length === 0 && <p className="text-xs text-muted-foreground">Aucun changement pour le moment.</p>}
        <ul className="divide-y divide-border">
          {data?.lignes.map((l) => (
            <li key={l.id} className="py-2.5 space-y-0.5">
              <p className="font-medium">
                <Sujet l={l} />
              </p>
              <p className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{groupe(l.ancien)}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" aria-label="devient" />
                <span className="font-semibold">{groupe(l.nouveau)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {l.par} · {quand(l.le)}
              </p>
            </li>
          ))}
        </ul>
        {data && data.total > data.lignes.length && (
          <Button variant="outline" className="w-full" onClick={() => setNombre((n) => n + TAILLE)}>
            Voir plus ({data.total - data.lignes.length} autres)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

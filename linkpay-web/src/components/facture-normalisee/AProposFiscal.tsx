import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * « À propos » du système de facturation : ce que la DGI et ses agents peuvent vérifier du logiciel — nom, version,
 * ISF (identifiant du SFE), environnement de l'e-MCF et NIM. Lecture seule, visible de tous les rôles autorisés.
 */
interface Logiciel {
  nom: string;
  module: string;
  version: string;
  environnement: 'test' | 'production';
  isf: string | null;
}

export function AProposFiscal({ orgId }: { orgId: string }) {
  const { data, isLoading } = useQuery<{ logiciel: Logiciel; profil: { emcf_nim?: string | null; nif?: string | null } | null }>({
    queryKey: ['fiscal-profil', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/profil`)).data,
  });
  const l = data?.logiciel;
  const lignes: [string, string][] = l
    ? [
        ['Logiciel', `${l.nom} — ${l.module}`],
        ['Version', l.version],
        ['ISF', l.isf ?? "pas encore attribué (en attente de l'homologation)"],
        ['e-MCF', l.environnement === 'production' ? 'Production' : 'Test de la DGI'],
        ['NIM de votre e-MCF', data?.profil?.emcf_nim || 'pas encore enregistré'],
        ['NIF de l\'entreprise', data?.profil?.nif || 'pas encore enregistré'],
      ]
    : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">À propos du logiciel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Les informations que la DGI peut contrôler : le même ISF est imprimé sur chaque facture et chaque rapport.
        </p>
        {isLoading && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" />}
        <dl className="divide-y divide-border">
          {lignes.map(([nom, valeur]) => (
            <div key={nom} className="py-2 flex items-start justify-between gap-4">
              <dt className="text-muted-foreground">{nom}</dt>
              <dd className="font-medium text-right break-words min-w-0">{valeur}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Loader2, WifiOff } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ClientFiscalForm } from './ClientFiscalForm';
import { FactureNormaliseeSheet } from './FactureNormaliseeSheet';
import { erreurClient, messageErreur, STATUTS, TONS, type ClientFiscal } from './shared';

/**
 * Sur le reçu d'une vente payée (caisse et Ventes), quand l'entreprise est soumise à la facture normalisée : choisir
 * le type de client et émettre la facture normalisée DGI. Si le caissier ne le fait pas, le serveur la fait seul au
 * bout de 2 minutes (« Particulier »). Sans réseau : la vente garde son bon provisoire, normalisé au retour du réseau.
 */
export function FactureNormaliseeVente({
  merchantId,
  sourceType,
  sourceId,
  horsLigne,
}: {
  merchantId?: string | null;
  sourceType: 'pos_ticket' | 'sale';
  sourceId?: string | null;
  /** Vente enregistrée sans réseau : rien n'est encore sur le serveur. */
  horsLigne?: boolean;
}) {
  const qc = useQueryClient();
  const [client, setClient] = useState<ClientFiscal>({ type: 'PP' });
  const [ouverte, setOuverte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = !!merchantId && !!sourceId && !horsLigne;
  const cle = ['facture-normalisee-vente', merchantId, sourceType, sourceId];

  const { data } = useQuery<{ active: boolean; organization_id: string | null; facture: any | null }>({
    queryKey: cle,
    enabled: actif,
    retry: false,
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/facture-normalisee/vente`, { params: { source_type: sourceType, source_id: sourceId } })).data,
  });

  const emettre = useMutation({
    mutationFn: async () =>
      (await api.post(`/merchants/${merchantId}/facture-normalisee/emettre`, { source_type: sourceType, source_id: sourceId, client })).data,
    onSuccess: (f: any) => {
      qc.setQueryData(cle, (old: any) => ({ ...(old ?? {}), facture: f }));
      if (f.status === 'confirmed') setOuverte(true);
      else setErreur(f.last_error_desc || 'Pas encore normalisée : elle le sera automatiquement.');
    },
    onError: (e) => setErreur(messageErreur(e, 'Émission impossible')),
  });

  if (horsLigne) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-warning/10 text-warning p-3 text-xs max-w-sm mx-auto">
        <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Vente sans réseau : ce reçu est un bon provisoire. Si votre entreprise est soumise à la facture normalisée, elle sera faite automatiquement au retour du réseau.</span>
      </div>
    );
  }
  if (!data?.active || !data.organization_id) return null;
  const f = data.facture;
  const statut = f ? STATUTS[f.status] : null;

  return (
    <div className="max-w-sm mx-auto rounded-2xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <FileCheck2 className="w-4 h-4 text-primary" /> Facture normalisée DGI
        </p>
        {statut && <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TONS[statut.ton]}`}>{statut.libelle}</span>}
      </div>

      {!f && (
        <>
          <ClientFiscalForm value={client} onChange={(c) => { setClient(c); setErreur(null); }} />
          <Button
            className="w-full"
            disabled={emettre.isPending}
            onClick={() => {
              const e = erreurClient(client);
              if (e) return setErreur(e);
              emettre.mutate();
            }}
          >
            {emettre.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <FileCheck2 className="mr-2 w-4 h-4" />}
            Émettre la facture normalisée
          </Button>
        </>
      )}

      {f && (
        <Button variant={f.status === 'confirmed' ? 'default' : 'outline'} className="w-full" onClick={() => setOuverte(true)}>
          {f.status === 'confirmed' ? `Voir et imprimer la facture ${f.rn}` : `Voir le bon provisoire ${f.rn}`}
        </Button>
      )}
      {erreur && <p className="text-xs text-destructive">{erreur}</p>}

      {ouverte && f && (
        <FactureNormaliseeSheet
          orgId={data.organization_id}
          factureId={f.id}
          onClose={() => {
            setOuverte(false);
            qc.invalidateQueries({ queryKey: cle });
          }}
        />
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Printer, RefreshCw, ShieldCheck, Undo2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/FormSheet';
import { PrintFlowStatus, ReceiptPreview, usePrintFlow } from '@/components/printing/ReceiptPrint';
import { buildFactureNormalisee, type VueFactureNormalisee } from '@/lib/printing/build-facture-normalisee';
import { messageErreur } from './shared';

/**
 * Une facture normalisée : aperçu exact de ce qui s'imprime, impression (la première est l'originale, les suivantes
 * portent DUPLICATA avec le même numéro), nouvel essai si elle n'est pas encore normalisée, avoir (patron, gérant).
 */
export function FactureNormaliseeSheet({
  orgId,
  factureId,
  onClose,
  onAvoir,
}: {
  orgId: string;
  factureId: string;
  onClose: () => void;
  /** Proposé seulement au patron et aux gérants, sur une facture de vente normalisée. */
  onAvoir?: (vue: VueFactureNormalisee) => void;
}) {
  const qc = useQueryClient();
  const cle = ['facture-normalisee', orgId, factureId];
  const { data: vue, isLoading, error } = useQuery<VueFactureNormalisee>({
    queryKey: cle,
    queryFn: async () => (await api.get(`/organizations/${orgId}/facture-normalisee/factures/${factureId}`)).data,
  });
  const lines = useMemo(() => (vue ? buildFactureNormalisee(vue) : []), [vue]);
  const flow = usePrintFlow();
  const [message, setMessage] = useState<string | null>(null);

  const imprimer = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/facture-normalisee/factures/${factureId}/impression`)).data as VueFactureNormalisee,
    onSuccess: (v) => {
      qc.setQueryData(cle, { ...v, facture: { ...v.facture, duplicata: true } });
      flow.print(buildFactureNormalisee(v), `Facture-${v.facture.rn.replace('/', '-')}`);
    },
    onError: (e) => setMessage(messageErreur(e, 'Impression impossible')),
  });

  const reessayer = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/facture-normalisee/factures/${factureId}/reessayer`)).data,
    onSuccess: (r: any) => {
      setMessage(r.status === 'confirmed' ? 'Facture normalisée par la DGI.' : r.last_error_desc || 'Toujours pas normalisée.');
      qc.invalidateQueries({ queryKey: cle });
      qc.invalidateQueries({ queryKey: ['factures-normalisees', orgId] });
    },
    onError: (e) => setMessage(messageErreur(e, 'Nouvel essai impossible')),
  });

  const f = vue?.facture;
  const avoirPossible = f && !f.provisoire && !f.avoir && ['FV', 'EV', 'FT', 'ET'].includes(f.type);

  return (
    <FormSheet onClose={onClose} title={f?.provisoire ? 'Bon provisoire' : 'Facture normalisée'} size="narrow">
      <div className="p-6 space-y-4">
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
        {error && <p className="text-sm text-destructive text-center">{messageErreur(error, 'Facture introuvable')}</p>}

        {f && (
          <div
            className={`flex items-start gap-2 rounded-xl p-3 text-sm ${f.provisoire ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}
          >
            {f.provisoire ? <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            <span>
              {f.provisoire
                ? f.erreur?.code === 'A_VERIFIER'
                  ? 'Réponse de la DGI incertaine : vérifiez la facture sur le site de vérification de la DGI avant toute autre action.'
                  : f.erreur?.description || 'Pas encore normalisée par la DGI : elle le sera automatiquement au retour du réseau.'
                : `Normalisée par la DGI — code ${f.code_def_dgi}`}
            </span>
          </div>
        )}

        {vue && <ReceiptPreview lines={lines} />}
        <PrintFlowStatus flow={flow} />
        {message && <p className="text-sm text-center text-muted-foreground">{message}</p>}

        {f && (
          <div className="max-w-sm mx-auto space-y-3">
            <div className="flex gap-3">
              {f.provisoire ? (
                f.erreur?.code !== 'A_VERIFIER' && (
                  <Button variant="outline" className="flex-1" onClick={() => reessayer.mutate()} disabled={reessayer.isPending}>
                    {reessayer.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <RefreshCw className="mr-2 w-4 h-4" />}
                    Réessayer
                  </Button>
                )
              ) : (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => imprimer.mutate()}
                  disabled={imprimer.isPending || flow.printing || flow.picking}
                >
                  {imprimer.isPending || flow.printing ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Printer className="mr-2 w-4 h-4" />}
                  {f.duplicata ? 'Imprimer un duplicata' : 'Imprimer'}
                </Button>
              )}
              <Button className="flex-1" onClick={onClose}>Fermer</Button>
            </div>
            {avoirPossible && onAvoir && vue && (
              <button
                onClick={() => onAvoir(vue)}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-destructive hover:underline"
              >
                <Undo2 className="w-4 h-4" /> Faire un avoir (rembourser, annuler, corriger)
              </button>
            )}
          </div>
        )}
      </div>
    </FormSheet>
  );
}

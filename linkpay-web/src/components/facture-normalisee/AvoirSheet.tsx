import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Minus, Plus, Undo2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormSheet } from '@/components/FormSheet';
import { PinInput } from '@/components/PinInput';
import { formatCurrency } from '@/lib/utils';
import type { VueFactureNormalisee } from '@/lib/printing/build-facture-normalisee';
import { messageErreur } from './shared';

const NATURES = [
  { code: 'RAM', libelle: 'Reprise', aide: 'Le client rend la marchandise (après paiement).' },
  { code: 'RAN', libelle: 'Annulation', aide: 'Vente annulée sans paiement ni livraison.' },
  { code: 'COR', libelle: 'Correction', aide: 'Erreur à corriger avant paiement / livraison.' },
] as const;

/**
 * Facture d'avoir sur une facture normalisée (patron, gérant, avec leur code PIN) : mêmes articles et même prix
 * que la facture d'origine, quantités au plus égales à ce qui reste remboursable (le serveur le vérifie aussi).
 */
export function AvoirSheet({
  orgId,
  origine,
  onClose,
  onDone,
}: {
  orgId: string;
  origine: VueFactureNormalisee;
  onClose: () => void;
  onDone: (avoir: any) => void;
}) {
  const [nature, setNature] = useState<'RAM' | 'RAN' | 'COR'>('RAM');
  const [quantites, setQuantites] = useState<number[]>(() => origine.articles.map((a) => a.quantite));
  const [motif, setMotif] = useState('');
  const [etape, setEtape] = useState<'choix' | 'pin'>('choix');
  const [pin, setPin] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const total = origine.articles.reduce((s, a, i) => s + Math.round(a.prix_unitaire_cents * (quantites[i] || 0)), 0);
  const choisies = origine.articles.map((a, i) => ({ ligne_id: a.ligne_id, quantite: String(quantites[i] ?? 0) })).filter((l) => Number(l.quantite) > 0);

  const envoyer = useMutation({
    mutationFn: async (code: string) =>
      (
        await api.post(`/organizations/${orgId}/facture-normalisee/factures/${origine.facture.id}/avoir`, {
          nature,
          pin: code,
          lignes: choisies,
          motif: motif.trim() || undefined,
        })
      ).data,
    onSuccess: onDone,
    onError: (e) => {
      setPin('');
      setEtape('choix');
      setErreur(messageErreur(e, "L'avoir n'a pas pu être émis"));
    },
  });

  if (etape === 'pin') {
    return (
      <FormSheet onClose={onClose} title="Confirmer l'avoir" size="narrow">
        <div className="p-6">
          <PinInput
            value={pin}
            onChange={(v) => {
              setPin(v);
              if (v.length === 4) envoyer.mutate(v);
            }}
            title="Votre code PIN"
            hint={`Avoir de ${formatCurrency(total, 'CDF')} sur la facture ${origine.facture.rn}`}
            message={envoyer.isPending ? 'Envoi à la DGI…' : undefined}
            onCancel={() => setEtape('choix')}
            autoFocus
          />
        </div>
      </FormSheet>
    );
  }

  return (
    <FormSheet onClose={onClose} title={`Avoir sur la facture ${origine.facture.rn}`} size="narrow">
      <div className="p-6 space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-semibold">Nature de l'avoir</p>
          <div className="grid grid-cols-3 gap-2">
            {NATURES.map((n) => (
              <button
                key={n.code}
                onClick={() => setNature(n.code)}
                className={`rounded-xl border p-2 text-xs font-semibold ${nature === n.code ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
              >
                {n.libelle}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{NATURES.find((n) => n.code === nature)?.aide}</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Articles à rembourser</p>
          {origine.articles.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-border p-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{a.nom}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(a.prix_unitaire_cents, 'CDF')} · vendu {a.quantite} · groupe {a.groupe}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button className="p-1.5 rounded-lg border" onClick={() => setQuantites((q) => q.map((v, j) => (j === i ? Math.max(0, +(v - 1).toFixed(3)) : v)))}>
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-12 text-center text-sm font-semibold">{quantites[i]}</span>
                <button
                  className="p-1.5 rounded-lg border"
                  onClick={() => setQuantites((q) => q.map((v, j) => (j === i ? Math.min(a.quantite, +(v + 1).toFixed(3)) : v)))}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <Input placeholder="Motif (facultatif), ex. produit défectueux" value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={100} />

        <div className="flex items-center justify-between font-semibold">
          <span>Total de l'avoir</span>
          <span>{formatCurrency(total, 'CDF')}</span>
        </div>
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}

        <Button className="w-full" variant="destructive" disabled={!choisies.length || envoyer.isPending} onClick={() => { setErreur(null); setEtape('pin'); }}>
          {envoyer.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Undo2 className="mr-2 w-4 h-4" />}
          Émettre l'avoir
        </Button>
      </div>
    </FormSheet>
  );
}

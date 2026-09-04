import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { PinInput } from '@/components/PinInput';
import { formatCurrency } from '@/lib/utils';
import { Loader2, Check, Search, ArrowLeft, ScanLine, Store } from 'lucide-react';

type Step = 'reference' | 'confirm' | 'pin' | 'processing' | 'success';

export default function PayInvoicePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('reference');
  const [reference, setReference] = useState('');
  const [invoice, setInvoice] = useState<any>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLooking(true);
    try {
      const { data } = await api.get(`/payment-requests/reference/${encodeURIComponent(reference.trim())}`);
      setInvoice(data);
      setStep('confirm');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Facture introuvable');
    } finally {
      setLooking(false);
    }
  };

  const handlePinComplete = async (val: string) => {
    setPin(val);
    if (val.length !== 4) return;
    setStep('processing');
    setError('');
    try {
      const { data } = await api.post(
        '/payments/wallet',
        { link_token: invoice.link_token, pin: val },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      setStep('success');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Le paiement a échoué');
      setPin('');
      setStep('pin');
    }
  };

  if (step === 'success') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Paiement réussi !</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {formatCurrency(invoice?.total_cents)} payé à {invoice?.merchant?.name}
            </p>
            <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Marchand</span>
                <span className="font-semibold text-foreground">{invoice?.merchant?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Référence</span>
                <span className="font-mono text-xs text-foreground">{result?.reference || invoice?.reference}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Moyen de paiement</span>
                <span className="text-foreground">Solde LinkPay</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Statut</span>
                <span className="font-semibold text-success">SUCCESS</span>
              </div>
            </div>
            <Button className="w-full mt-6" size="lg" onClick={() => navigate('/dashboard')}>
              Retour au tableau de bord
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'processing') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-foreground font-semibold">Paiement en cours...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'pin') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <button onClick={() => setStep('confirm')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 float-left">
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4 mt-8 clear-left">
                {error}
              </div>
            )}
            <h2 className="text-lg font-bold text-foreground mb-1 mt-10 clear-left">Code PIN</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Confirmez le paiement de {formatCurrency(invoice?.total_cents)}
            </p>
            <PinInput value={pin} onChange={handlePinComplete} length={4} autoFocus />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6">
            <button onClick={() => setStep('reference')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="w-4 h-4" /> Modifier
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
                {error}
              </div>
            )}
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3 overflow-hidden">
                {invoice?.merchant?.logo_url ? (
                  <img src={invoice.merchant.logo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Store className="w-7 h-7 text-primary" />
                )}
              </div>
              <p className="font-bold text-foreground text-lg">{invoice?.merchant?.name}</p>
              <p className="text-sm text-muted-foreground">{invoice?.description}</p>
            </div>
            <div className="rounded-xl bg-secondary p-4 space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Référence</span>
                <span className="font-mono text-xs text-foreground">{invoice?.reference}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-semibold text-foreground">{formatCurrency(invoice?.amount_cents)}</span>
              </div>
              {invoice?.fees?.total_fees_cents > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Frais</span>
                  <span className="text-foreground">{formatCurrency(invoice.fees.total_fees_cents)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold pt-2 border-t border-border">
                <span className="text-foreground">Total débité (solde LinkPay)</span>
                <span className="text-foreground">{formatCurrency(invoice?.total_cents)}</span>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={() => setStep('pin')}>
              Payer {formatCurrency(invoice?.total_cents)}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardContent className="pt-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <ScanLine className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1 text-center">Payer une facture</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center">Entrez la référence indiquée par le marchand</p>
          <form onSubmit={handleLookup} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="reference" className="font-semibold">Référence de la facture</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="reference"
                  placeholder="LP-20260904-A1B2C3"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  required
                  autoFocus
                  className="pl-10 font-mono"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={looking || !reference}>
              {looking && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Rechercher
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

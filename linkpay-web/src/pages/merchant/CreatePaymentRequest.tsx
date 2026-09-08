import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Loader2, Copy, Check, DollarSign, FileText, User, Phone } from 'lucide-react';

export default function CreatePaymentRequestPage() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [description, setDescription] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const { data: merchant } = useQuery({
    queryKey: ['merchant-me'],
    queryFn: async () => (await api.get('/merchants/me')).data,
  });

  // Prefill with the shop's own default currency, but still overridable per link.
  useEffect(() => {
    if (merchant?.default_currency === 'USD') setCurrency('USD');
  }, [merchant?.default_currency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const amountCents = Math.round(parseFloat(amount) * 100);
      if (!amountCents || amountCents < 50) {
        setError(`Montant minimum : 0.50 ${currency}`);
        setLoading(false);
        return;
      }
      const { data } = await api.post('/payment-requests', {
        amount_cents: amountCents,
        currency,
        description,
        customer_info: customerName || customerPhone ? { name: customerName, phone: customerPhone } : undefined,
      });
      setResult(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la creation');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    if (result?.link_token) {
      const url = `${window.location.origin}/p/${result.link_token}`;
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (result) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Demande créée !</h2>
            <p className="text-sm text-muted-foreground mb-6">Partagez le lien avec votre client</p>
            {result.qr_code_url && (
              <div className="flex justify-center mb-4">
                <img src={result.qr_code_url} alt="QR Code" className="w-48 h-48 rounded-2xl border border-border" />
              </div>
            )}
            <div className="rounded-xl bg-secondary p-3 text-left">
              <p className="text-sm text-muted-foreground mb-1">Lien de paiement</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm truncate text-foreground">{window.location.origin}/p/{result.link_token}</code>
                <Button variant="ghost" size="icon" onClick={copyLink}>
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setResult(null)}>
                Créer une autre
              </Button>
              <Button className="flex-1" onClick={() => navigate('/dashboard/payment-requests')}>
                Voir toutes
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-xl font-bold text-foreground mb-1">Nouvelle demande de paiement</h2>
          <p className="text-sm text-muted-foreground mb-6">Générez un lien et QR code de paiement</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label className="font-semibold">Devise</Label>
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount" className="font-semibold">Montant ({currency})</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  placeholder="5000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  autoFocus
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description" className="font-semibold">Description (optionnel)</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="description"
                  placeholder="Achat produit XYZ"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cname" className="font-semibold">Client (optionnel)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="cname" placeholder="Jean Dupont" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="pl-10" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cphone" className="font-semibold">Téléphone (optionnel)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="cphone" placeholder="+243..." value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="pl-10" />
                </div>
              </div>
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Générer le lien
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Wallet, Loader2, Landmark, Pencil } from 'lucide-react';

const MOBILE_MONEY_OPERATORS = ['M-Pesa', 'Orange Money', 'Airtel Money', 'Afrimoney'];

interface SettlementAccount {
  method: 'mobile_money' | 'bank';
  operator?: string;
  bank_name?: string;
  number: string;
  holder_name: string;
}

const EMPTY_ACCOUNT: SettlementAccount = { method: 'mobile_money', operator: 'M-Pesa', number: '', holder_name: '' };

function describeAccount(a: SettlementAccount) {
  const where = a.method === 'bank' ? a.bank_name || 'Banque' : a.operator || 'Mobile Money';
  return `${where} · ${a.number} · ${a.holder_name}`;
}

/** Where the platform sends this store's settlements — required before the
 * first request, since the admin pays each one out by hand. */
function SettlementAccountCard({ merchant }: { merchant: any }) {
  const queryClient = useQueryClient();
  const current: SettlementAccount | null = merchant?.settlement_account?.number ? merchant.settlement_account : null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SettlementAccount>(EMPTY_ACCOUNT);

  const saveMutation = useMutation({
    mutationFn: async (account: SettlementAccount) => {
      const payload: SettlementAccount = {
        method: account.method,
        number: account.number.trim(),
        holder_name: account.holder_name.trim(),
        ...(account.method === 'bank' ? { bank_name: account.bank_name?.trim() } : { operator: account.operator }),
      };
      await api.put(`/merchants/${merchant.id}`, { settlement_account: payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-me'] });
      setEditing(false);
    },
  });
  const saveError = (saveMutation.error as any)?.response?.data?.message;

  const startEditing = () => {
    setForm(current ? { ...EMPTY_ACCOUNT, ...current } : EMPTY_ACCOUNT);
    saveMutation.reset();
    setEditing(true);
  };

  const set = (patch: Partial<SettlementAccount>) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.number.trim().length >= 6 && form.holder_name.trim().length > 0 && (form.method === 'mobile_money' || !!form.bank_name?.trim());

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Landmark className="w-4 h-4 text-primary" />
          Compte de versement
        </CardTitle>
        {current && !editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            <Pencil className="w-4 h-4 mr-1" /> Modifier
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!editing ? (
          current ? (
            <p className="text-sm text-foreground">{describeAccount(current)}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Indiquez où vous voulez recevoir votre argent. C'est obligatoire avant votre première demande de règlement.
              </p>
              <Button className="w-full" onClick={startEditing}>Ajouter un compte de versement</Button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="payout_method">Type de compte</Label>
              <Select
                id="payout_method"
                value={form.method}
                onChange={(e) => set({ method: e.target.value as SettlementAccount['method'] })}
              >
                <option value="mobile_money">Mobile Money</option>
                <option value="bank">Compte bancaire</option>
              </Select>
            </div>
            {form.method === 'mobile_money' ? (
              <div className="space-y-2">
                <Label htmlFor="payout_operator">Opérateur</Label>
                <Select id="payout_operator" value={form.operator} onChange={(e) => set({ operator: e.target.value })}>
                  {MOBILE_MONEY_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="payout_bank">Banque</Label>
                <Input id="payout_bank" placeholder="Rawbank, Equity BCDC..." value={form.bank_name || ''} onChange={(e) => set({ bank_name: e.target.value })} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="payout_number">{form.method === 'bank' ? 'Numéro de compte' : 'Numéro de téléphone'}</Label>
              <Input
                id="payout_number"
                inputMode={form.method === 'bank' ? 'text' : 'tel'}
                placeholder={form.method === 'bank' ? '00011-00000-...' : '0990000000'}
                value={form.number}
                onChange={(e) => set({ number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout_holder">Nom du titulaire</Label>
              <Input id="payout_holder" placeholder="Jean Mukendi" value={form.holder_name} onChange={(e) => set({ holder_name: e.target.value })} />
            </div>
            {saveMutation.isError && (
              <p className="text-sm text-destructive">{Array.isArray(saveError) ? saveError.join(', ') : saveError || "Échec de l'enregistrement"}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Annuler</Button>
              <Button className="flex-1" disabled={!valid || saveMutation.isPending} onClick={() => saveMutation.mutate(form)}>
                {saveMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettlementsPage() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['settlements'],
    queryFn: async () => {
      const { data } = await api.get('/settlements');
      return data;
    },
  });

  const { data: balance } = useQuery({
    queryKey: ['settlement-balance'],
    queryFn: async () => {
      const { data } = await api.get('/settlements/balance');
      return data;
    },
  });

  const { data: merchant } = useQuery({
    queryKey: ['merchant-me'],
    queryFn: async () => (await api.get('/merchants/me')).data,
  });
  const hasPayoutAccount = !!merchant?.settlement_account?.number;

  const requestMutation = useMutation({
    mutationFn: async () => {
      await api.post('/settlements', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      queryClient.invalidateQueries({ queryKey: ['settlement-balance'] });
    },
  });
  const requestError = (requestMutation.error as any)?.response?.data?.message;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Règlements" />

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.available?.CDF || 0, 'CDF')}</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.available?.USD || 0, 'USD')}</p>
            <p className="text-sm text-muted-foreground">Solde disponible</p>
            <Button
              className="w-full mt-4"
              disabled={(!balance?.available?.CDF && !balance?.available?.USD) || !hasPayoutAccount || requestMutation.isPending}
              onClick={() => requestMutation.mutate()}
            >
              {requestMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Demander un règlement
            </Button>
            {merchant && !hasPayoutAccount && (
              <p className="text-xs text-muted-foreground mt-2">Ajoutez d'abord votre compte de versement ci-dessous.</p>
            )}
            {requestMutation.isError && (
              <p className="text-sm text-destructive mt-2">{requestError || 'Échec de la demande de règlement'}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <Wallet className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.pending?.CDF || 0, 'CDF')}</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.pending?.USD || 0, 'USD')}</p>
            <p className="text-sm text-muted-foreground">En attente</p>
          </CardContent>
        </Card>
      </div>

      {merchant && <SettlementAccountCard merchant={merchant} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Historique des règlements</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div>
                    <p className="font-semibold text-sm text-foreground">{s.reference}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(s.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-foreground">{formatCurrency(s.net_cents, s.currency)}</span>
                    <Badge variant={s.status === 'COMPLETED' ? 'success' : s.status === 'FAILED' ? 'error' : 'warning'}>
                      {s.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun règlement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { FormSheet } from '@/components/FormSheet';
import { PaymentRequestShareCard } from '@/components/PaymentRequestShareCard';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Plus, CheckCircle, XCircle, Clock, ChevronRight } from 'lucide-react';

export default function PaymentRequestsPage() {
  const { data } = useQuery({
    queryKey: ['payment-requests'],
    queryFn: async () => {
      const { data } = await api.get('/payment-requests');
      return data;
    },
  });
  const [selected, setSelected] = useState<any>(null);

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Demandes de paiement"
        action={{ label: 'Créer', icon: Plus, to: '/dashboard/payment-requests/new' }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Toutes les demandes</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((req: any) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setSelected(req)}
                  className="w-full flex items-center justify-between py-3 border-b border-border last:border-0 text-left hover:bg-accent/50 transition-colors -mx-2 px-2 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate text-foreground">{req.description || req.reference}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(req.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className="font-bold text-foreground">{formatCurrency(req.amount_cents, req.currency)}</span>
                    <Badge variant={req.status === 'PAID' ? 'success' : req.status === 'CANCELLED' || req.status === 'EXPIRED' ? 'error' : 'warning'}>
                      {req.status}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucune demande de paiement</p>
          )}
        </CardContent>
      </Card>

      {selected && (
        <FormSheet onClose={() => setSelected(null)} title="Demande de paiement">
          <div className="p-6 max-w-lg mx-auto text-center">
            <p className="font-semibold text-foreground text-lg mb-1">{selected.description || selected.reference}</p>
            <p className="text-2xl font-bold text-foreground mb-6">{formatCurrency(selected.amount_cents, selected.currency)}</p>

            {(selected.status === 'CREATED' || selected.status === 'PENDING') && (
              <PaymentRequestShareCard request={selected} />
            )}

            {selected.status === 'PAID' && (
              <div className="rounded-xl bg-success/10 border border-success/20 p-6">
                <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
                <p className="font-semibold text-foreground">Payé</p>
                {selected.updated_at && <p className="text-sm text-muted-foreground mt-1">{formatDate(selected.updated_at)}</p>}
              </div>
            )}

            {selected.status === 'CANCELLED' && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-6">
                <XCircle className="w-10 h-10 text-destructive mx-auto mb-2" />
                <p className="font-semibold text-foreground">Demande annulée</p>
              </div>
            )}

            {selected.status === 'EXPIRED' && (
              <div className="rounded-xl bg-warning/10 border border-warning/20 p-6">
                <Clock className="w-10 h-10 text-warning mx-auto mb-2" />
                <p className="font-semibold text-foreground">Lien expiré</p>
              </div>
            )}
          </div>
        </FormSheet>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Plus, Share2 } from 'lucide-react';
import { shareOrCopy } from '@/lib/share';

export default function PaymentRequestsPage() {
  const { data } = useQuery({
    queryKey: ['payment-requests'],
    queryFn: async () => {
      const { data } = await api.get('/payment-requests');
      return data;
    },
  });

  const shareLink = (req: { link_token: string; amount_cents: number; currency: string }) => {
    shareOrCopy({
      title: 'Lien de paiement LinkPay',
      text: `Payez ${formatCurrency(req.amount_cents, req.currency)} via LinkPay`,
      url: `${window.location.origin}/p/${req.link_token}`,
    });
  };

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
                <div key={req.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate text-foreground">{req.description || req.reference}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(req.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className="font-bold text-foreground">{formatCurrency(req.amount_cents, req.currency)}</span>
                    <Badge variant={req.status === 'PAID' ? 'success' : req.status === 'CANCELLED' || req.status === 'EXPIRED' ? 'error' : 'warning'}>
                      {req.status}
                    </Badge>
                    {req.status === 'CREATED' || req.status === 'PENDING' ? (
                      <Button variant="ghost" size="icon" onClick={() => shareLink(req)}>
                        <Share2 className="w-4 h-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucune demande de paiement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

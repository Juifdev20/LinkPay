import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, Share2 } from 'lucide-react';
import { shareOrCopy, publicOrigin } from '@/lib/share';
import { formatCurrency } from '@/lib/utils';

interface PaymentRequestShareCardProps {
  request: {
    link_token: string;
    reference?: string;
    qr_code_url?: string;
    amount_cents: number;
    currency: string;
  };
}

/**
 * The QR + short reference code + shareable link block a merchant needs to
 * hand a payment request to a customer — three ways to pay the same
 * request (scan, type the code, or tap a shared link), matching the
 * ScanPay reference flow. Used both right after creating a request
 * (CreatePaymentRequest.tsx) and when reopening an existing unpaid one
 * from the list (PaymentRequests.tsx) — same data shape either way, since
 * `GET /payment-requests` already returns qr_code_url/link_token/reference
 * per row (no extra fetch needed to reopen one).
 */
export function PaymentRequestShareCard({ request }: PaymentRequestShareCardProps) {
  const [copied, setCopied] = useState(false);
  const paymentLink = `${publicOrigin()}/p/${request.link_token}`;

  const copyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    const method = await shareOrCopy({
      title: 'Lien de paiement ScanLinkPay',
      text: `Payez ${formatCurrency(request.amount_cents, request.currency)} via ScanLinkPay`,
      url: paymentLink,
    });
    // The native share sheet already gives its own feedback — only show
    // "Copié" when we actually fell back to the clipboard.
    if (method === 'copy') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div>
      {request.qr_code_url && (
        <div className="flex justify-center mb-4">
          <img src={request.qr_code_url} alt="QR Code" className="w-48 h-48 rounded-2xl border border-border" />
        </div>
      )}
      {request.reference && (
        <div className="mb-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Ou faites saisir le code</p>
          <p className="font-mono text-xl font-bold tracking-wider text-foreground">{request.reference}</p>
        </div>
      )}
      <div className="rounded-xl bg-secondary p-3 text-left">
        <p className="text-sm text-muted-foreground mb-1">Lien de paiement</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm truncate text-foreground">{paymentLink}</code>
          <Button variant="ghost" size="icon" onClick={copyLink}>
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <Button className="w-full mt-4" onClick={shareLink}>
        <Share2 className="mr-2 w-4 h-4" />
        Partager le lien
      </Button>
    </div>
  );
}

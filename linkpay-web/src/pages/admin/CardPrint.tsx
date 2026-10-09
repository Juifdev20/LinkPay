import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Printer, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CardBack, CardFront, ScaledCard, type CardFaceData } from '@/components/card/ScanLinkPayCard';
import { groupDigits, validThru } from '@/lib/cards';

const BLEED_MM = 1.5;

/**
 * Print view of one card: both faces at their real size (85.60 × 53.98 mm), one per page, no margins. "Imprimer"
 * opens the browser's print dialog: pick the card printer, or "Enregistrer au format PDF" for a print shop.
 * With the bleed option the page is 3 mm larger and the background runs to the edge, as print shops ask.
 */
export default function CardPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<CardFaceData | null>(null);
  const [error, setError] = useState('');
  const [bleed, setBleed] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    // Opening the print view is counted and audited: once, even if React renders twice.
    if (asked.current || !id) return;
    asked.current = true;
    api.post(`/admin/cards/${id}/print`)
      .then(({ data: d }) => setData({
        holderName: d.holder_name, numberText: d.card_number_formatted || groupDigits(d.card_number), validThru: validThru(d.expires_on),
        serialNo: d.serial_no, qrUrl: d.qr_url, servicePhone: d.settings.service_phone, lostCardPhone: d.settings.lost_card_phone, webDomain: d.settings.web_domain, partnerLogos: d.settings.partner_logos,
      }))
      .catch((e) => setError(e?.response?.data?.message || "Impossible d'ouvrir cette carte."));
  }, [id]);

  const b = bleed ? BLEED_MM : 0;
  const w = (85.6 + 2 * b).toFixed(2);
  const h = (53.98 + 2 * b).toFixed(2);

  return (
    <div className="min-h-screen bg-muted/30">
      {data && <style>{`@media print { @page { size: ${w}mm ${h}mm; margin: 0 } html, body { margin: 0 !important; padding: 0 !important; background: #fff !important } }`}</style>}

      <div className="slp-print-hide p-4 max-w-xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard/admin/cards')}><ArrowLeft className="w-4 h-4 mr-1" /> Retour aux cartes</Button>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        {!data && !error && <div className="py-16"><Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" /></div>}
        {data && (
          <>
            <ScaledCard front={<CardFront data={data} />} />
            <ScaledCard front={<CardBack data={data} />} />
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={bleed} onCheckedChange={(v) => setBleed(v === true)} />
                Avec fond perdu de {BLEED_MM} mm (pour une imprimerie)
              </label>
              <p className="text-muted-foreground">
                Dans la fenêtre d'impression : taille réelle (100 %), sans marges ni en-têtes. Le recto et le verso sortent sur deux pages de {w} × {h} mm.
              </p>
              <Button className="w-full" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Imprimer la carte</Button>
            </div>
          </>
        )}
      </div>

      {/* What the printer receives: real size, --u = 1mm. Hidden on screen. */}
      {data && (
        <div className="slp-print-only" style={{ ['--u' as any]: '1mm' }}>
          <div className="slp-print-page" style={{ width: `${w}mm`, height: `${h}mm`, overflow: 'hidden' }}><CardFront data={data} bleedMm={b} /></div>
          <div className="slp-print-page" style={{ width: `${w}mm`, height: `${h}mm`, overflow: 'hidden' }}><CardBack data={data} bleedMm={b} /></div>
        </div>
      )}
    </div>
  );
}

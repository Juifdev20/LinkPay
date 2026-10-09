import { useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import logo from '@/assets/logo.png';
import { DRC_PATH } from './drc-map';
import './card.css';

export interface PartnerLogo {
  name: string;
  image: string;
}

export interface CardFaceData {
  /** Printed in capitals, as on the card. */
  holderName: string;
  /** Already formatted ("9243 0012 3456 7895") or masked ("•••• •••• •••• 7895"). */
  numberText: string;
  /** "MM/YY" */
  validThru: string;
  serialNo?: number | null;
  /** The link the QR code opens. Omit it and no QR is drawn (card not issued yet). */
  qrUrl?: string | null;
  servicePhone?: string | null;
  /** The line to call when the card is lost or stolen. */
  lostCardPhone?: string | null;
  webDomain?: string | null;
  partnerLogos?: PartnerLogo[];
}

/** QR code as an SVG string: crisp at any size, including on paper. Error correction Q: a worn card still scans. */
export function useQrSvg(url?: string | null): string {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    if (!url) {
      setSvg('');
      return;
    }
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'Q', margin: 0, color: { dark: '#0B1033', light: '#0000' } })
      .then((s) => alive && setSvg(s.replace(/<svg /, '<svg shape-rendering="crispEdges" ')))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [url]);
  return svg;
}

function MapWatermark({ id: face }: { id: string }) {
  // Unique per instance: the same card can be on the page twice (the preview and the print copy), and an SVG clip-path
  // that points at an id living in a hidden copy is silently ignored — the flag stripe then runs outside the map.
  const id = `${face}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg className="map" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <clipPath id={`c-${id}`}><path d={DRC_PATH} /></clipPath>
        <pattern id={`d-${id}`} width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="2.2" fill="#fff" fillOpacity=".2" /></pattern>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8fc2ff" stopOpacity=".26" /><stop offset="1" stopColor="#3f7dff" stopOpacity=".12" /></linearGradient>
      </defs>
      <path d={DRC_PATH} fill={`url(#g-${id})`} />
      <g clipPath={`url(#c-${id})`}>
        <g className="flag" transform="rotate(-38 500 500)">
          <rect x="-300" y="415" width="1600" height="170" fill="#ffd23a" fillOpacity=".16" />
          <rect x="-300" y="445" width="1600" height="110" fill="#ff5a5a" fillOpacity=".2" />
        </g>
        <rect width="1000" height="1000" fill={`url(#d-${id})`} />
      </g>
      <path d={DRC_PATH} fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="3" />
    </svg>
  );
}

function Graticule() {
  return (
    <svg className="grat" viewBox="0 0 856 540" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth="1.2">
        <path d="M0 120 Q428 40 856 120" /><path d="M0 230 Q428 150 856 230" /><path d="M0 340 Q428 260 856 340" />
        <path d="M200 0 Q170 270 200 540" /><path d="M400 0 Q370 270 400 540" /><path d="M600 0 Q570 270 600 540" /><path d="M800 0 Q770 270 800 540" />
      </g>
    </svg>
  );
}

interface FaceProps {
  data: CardFaceData;
  /** Extra background around the card, in mm, for the print shop (0 on screen). */
  bleedMm?: number;
  className?: string;
}

/** The front: brand, QR code, number, holder, validity. */
export function CardFront({ data, bleedMm = 0 }: FaceProps) {
  const qrSvg = useQrSvg(data.qrUrl);
  return (
    <div className={`slp-card front${bleedMm ? ' has-bleed' : ''}`} style={bleedMm ? ({ ['--b']: `calc(${bleedMm} * var(--u))` } as React.CSSProperties) : undefined}>
      <div className="slp-inner">
        <Graticule />
        <svg className="wave" viewBox="0 0 856 200" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 120 C 150 60 300 30 470 80 S 760 140 856 70 V200 H0Z" fill="rgba(120,170,255,.16)" />
          <path d="M0 150 C 180 100 330 90 500 130 S 770 170 856 120 V200 H0Z" fill="rgba(10,20,140,.35)" />
        </svg>
        <MapWatermark id="front" />
        <div className="abs brand">
          <div className="word">ScanLink<b>Pay</b></div>
          <div className="slogan">PAYEZ. RECEVEZ. SIMPLEMENT.</div>
        </div>
        <div className="abs pill">CDF • USD</div>
        <div className="abs hint">
          <div className="t">Scannez pour payer</div>
          <div className="s">Présentez cette carte, scannez le code avec l’appareil photo. Le paiement est confirmé avec votre PIN.</div>
        </div>
        <div className={`abs qr${qrSvg ? '' : ' none'}`}>
          <i /><i /><i /><i />
          <div className="tile" {...(qrSvg ? { dangerouslySetInnerHTML: { __html: qrSvg } } : { children: 'Carte non émise' })} />
        </div>
        <div className="abs num">{data.numberText}</div>
        <div className="abs holder"><div className="lbl">Titulaire</div><div className="val">{data.holderName}</div></div>
        <div className="abs valid"><div className="lbl">Valide jusqu’au</div><div className="val">{data.validThru}</div></div>
        <div className="abs logo-br"><img src={logo} alt="ScanLinkPay" /></div>
      </div>
    </div>
  );
}

/** The back: contact (only when the super admin set it), signature panel, terms, partner logos. */
export function CardBack({ data, bleedMm = 0 }: FaceProps) {
  const logos = data.partnerLogos ?? [];
  return (
    <div className={`slp-card back${bleedMm ? ' has-bleed' : ''}`} style={bleedMm ? ({ ['--b']: `calc(${bleedMm} * var(--u))` } as React.CSSProperties) : undefined}>
      <div className="slp-inner">
        <Graticule />
        <MapWatermark id="back" />
        {/* Both lines are the super admin's to set; each is printed only when it is set. */}
        {data.servicePhone && <div className="abs hot" style={{ left: 'calc(4.5 * var(--u))' }}>Service client : {data.servicePhone}</div>}
        {(data.lostCardPhone || data.servicePhone) && (
          <div className="abs hot" style={{ right: 'calc(4.5 * var(--u))' }}>
            {data.lostCardPhone ? `Carte perdue ou volée : ${data.lostCardPhone}` : 'Carte perdue ou volée : bloquez-la dans l’application'}
          </div>
        )}
        <div className="abs stripe" />
        <div className="abs siglabel">SIGNATURE DU TITULAIRE</div>
        <div className="abs sig">{data.serialNo ? <em>Réf. {String(data.serialNo).padStart(6, '0')}</em> : null}</div>
        <div className="abs terms">
          <b>Carte personnelle et incessible.</b> Tout paiement exige le code PIN du titulaire. Cette carte ne contient ni solde ni code secret : consultez votre solde dans l’application ScanLinkPay. Si vous trouvez cette carte, merci de la déposer auprès de ScanLinkPay.{data.webDomain ? ` ${data.webDomain}` : ''}
        </div>
        {logos.length > 0 && (
          <div className="abs band">
            <span className="k">Recharge · Retrait</span>
            <span className="ps">{logos.map((l) => <img key={l.name} className="p" alt={l.name} src={l.image} />)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Shows a card at the width of its container (a card is 85.6 mm wide: --u is set to the pixels of 1 mm of the card). `flip` turns it over like a real one.
 */
export function ScaledCard({ front, back, flipped = false }: { front: React.ReactNode; back?: React.ReactNode; flipped?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState(3.7);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setUnit(el.clientWidth / 85.6);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const face: React.CSSProperties = { position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' };
  return (
    <div ref={ref} style={{ width: '100%', aspectRatio: '85.6 / 53.98', perspective: '1200px', ['--u' as any]: `${unit}px` }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d', transition: 'transform .6s', transform: flipped ? 'rotateY(180deg)' : 'none' }}>
        <div style={face}>{front}</div>
        {back && <div style={{ ...face, transform: 'rotateY(180deg)' }}>{back}</div>}
      </div>
    </div>
  );
}

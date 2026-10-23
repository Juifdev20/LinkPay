import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { deliverPdf } from '@/lib/report-pdf';
import { Copy, Check, FileDown, KeyRound, ShieldAlert, ArrowRight } from 'lucide-react';

/** The recovery code on a sheet to print or keep: what it is for, and the code itself. */
function recoveryPdf(code: string, phone?: string) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('ScanLinkPay — Code de secours', 14, 22);
  doc.setFontSize(11);
  if (phone) doc.text(`Compte : ${phone}`, 14, 34);
  doc.text('Gardez ce code en lieu sûr. Il permet de choisir un nouveau mot de passe', 14, 46);
  doc.text("si vous l'oubliez (« Mot de passe oublié ? » sur l'écran de connexion).", 14, 53);
  doc.setFontSize(28);
  doc.setFont('courier', 'bold');
  doc.text(code, 14, 75);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Ne le donnez à personne : ScanLinkPay ne vous le demandera jamais.', 14, 90);
  doc.text(`Émis le ${new Date().toLocaleString('fr-FR')}. Chaque nouveau code remplace le précédent.`, 14, 97);
  return doc;
}

/**
 * Shows a freshly issued recovery code — the only time it can be read. The
 * person copies it or saves it as a PDF and confirms they kept it before going
 * on: without SMS, it is their way back in if they forget the password.
 */
export function RecoveryCodePanel({ code, phone, onDone, doneLabel = 'Continuer' }: { code: string; phone?: string; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [kept, setKept] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* copy not allowed: the code is on screen */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand">
        <KeyRound className="h-7 w-7" />
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-tight text-foreground">Votre code de secours</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Si vous oubliez votre mot de passe, ce code vous permettra d'en choisir un nouveau. Notez-le ou enregistrez-le : <span className="font-semibold text-foreground">il ne sera plus affiché.</span>
      </p>
      <p className="mt-5 select-all rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.06] px-4 py-5 font-mono text-[1.4rem] font-bold tracking-[0.18em] text-foreground">
        {code}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={copy}>
          {copied ? <Check className="mr-2 h-4 w-4 text-success" /> : <Copy className="mr-2 h-4 w-4" />} {copied ? 'Copié' : 'Copier'}
        </Button>
        <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => deliverPdf(recoveryPdf(code, phone), 'code-de-secours-scanlinkpay.pdf', 'Enregistrer le code de secours').catch(() => undefined)}>
          <FileDown className="mr-2 h-4 w-4" /> PDF
        </Button>
      </div>
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-2.5 text-left text-xs leading-relaxed text-warning">
        <ShieldAlert className="mt-px h-4 w-4 shrink-0" /> Ne le donnez à personne : ScanLinkPay ne vous le demandera jamais.
      </p>
      <label htmlFor="kept" className="mt-4 flex cursor-pointer items-start gap-2.5 text-left text-sm text-muted-foreground">
        <Checkbox id="kept" checked={kept} onCheckedChange={(c) => setKept(c === true)} className="mt-px" />
        J'ai noté ou enregistré mon code de secours.
      </label>
      <Button type="button" className="mt-5 h-[52px] w-full rounded-xl text-base font-semibold" disabled={!kept} onClick={onDone}>
        {doneLabel} <ArrowRight className="ml-2 h-5 w-5" />
      </Button>
    </div>
  );
}

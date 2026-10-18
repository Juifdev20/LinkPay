import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { deliverPdf } from '@/lib/report-pdf';
import { Copy, Check, FileDown, KeyRound } from 'lucide-react';

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
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <KeyRound className="h-7 w-7 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">Votre code de secours</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Si vous oubliez votre mot de passe, ce code vous permettra d'en choisir un nouveau. Notez-le ou enregistrez-le : il ne sera plus affiché.
        </p>
      </div>
      <p className="select-all rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-5 font-mono text-2xl font-bold tracking-[0.2em] text-foreground">
        {code}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check className="mr-2 h-4 w-4 text-success" /> : <Copy className="mr-2 h-4 w-4" />} Copier
        </Button>
        <Button type="button" variant="outline" onClick={() => deliverPdf(recoveryPdf(code, phone), 'code-de-secours-scanlinkpay.pdf', 'Enregistrer le code de secours').catch(() => undefined)}>
          <FileDown className="mr-2 h-4 w-4" /> Enregistrer (PDF)
        </Button>
      </div>
      <div className="flex items-start gap-2 text-left">
        <Checkbox id="kept" checked={kept} onCheckedChange={(c) => setKept(c === true)} className="mt-0.5" />
        <Label htmlFor="kept" className="cursor-pointer text-sm font-normal text-muted-foreground">
          J'ai noté ou enregistré mon code de secours.
        </Label>
      </div>
      <Button type="button" className="w-full py-6 text-base font-semibold" disabled={!kept} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

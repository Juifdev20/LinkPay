import { Input } from '@/components/ui/input';
import { TYPES_CLIENT, type ClientFiscal } from './shared';

/** Le type de client (obligatoire pour la DGI) et ses informations quand il les demande sur sa facture. */
export function ClientFiscalForm({ value, onChange }: { value: ClientFiscal; onChange: (c: ClientFiscal) => void }) {
  const maj = (champ: Partial<ClientFiscal>) => onChange({ ...value, ...champ });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TYPES_CLIENT.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => maj({ type: t.type })}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              value.type === t.type ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'
            }`}
            title={t.libelle}
          >
            {t.court}
          </button>
        ))}
      </div>
      {value.type !== 'PP' && (
        <div className="grid gap-2">
          <Input placeholder={value.type === 'PM' ? 'Dénomination de l’entreprise' : 'Nom du client'} value={value.nom ?? ''} onChange={(e) => maj({ nom: e.target.value })} />
          {value.type !== 'AO' && (
            <Input
              placeholder="NIF du client (9 caractères)"
              value={value.nif ?? ''}
              maxLength={9}
              onChange={(e) => maj({ nif: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            />
          )}
          {value.type === 'AO' && (
            <Input
              placeholder="Référence du certificat d'exonération"
              value={value.referenceExoneration ?? ''}
              onChange={(e) => maj({ referenceExoneration: e.target.value })}
            />
          )}
          <Input placeholder="Adresse (facultatif)" value={value.adresse ?? ''} onChange={(e) => maj({ adresse: e.target.value })} />
          <Input placeholder="Téléphone ou e-mail (facultatif)" value={value.contact ?? ''} onChange={(e) => maj({ contact: e.target.value })} />
        </div>
      )}
      {value.type === 'PP' && <p className="text-xs text-muted-foreground">Particulier : aucune information obligatoire.</p>}
    </div>
  );
}

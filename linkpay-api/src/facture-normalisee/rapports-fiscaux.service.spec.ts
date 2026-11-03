import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';
import { RapportsFiscauxService } from './rapports-fiscaux.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const FIN_Z3 = '2026-11-02T22:00:00.000Z';

function monter(o: { droits?: 'gestion' | 'lecture'; dernierZ?: { seq: number; period_end: string } | null; conflit?: boolean } = {}) {
  const inseres: any[] = [];
  const { service, queries } = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'fiscal_reports' && has(q, 'insert')) {
      const ligne = q.calls.find((c) => c.method === 'insert')!.args[0];
      inseres.push(ligne);
      if (o.conflit) return { error: { code: '23505', message: 'duplicate' } };
      return { data: { id: 'r1', created_at: '2026-11-03T10:00:00Z', ...ligne } };
    }
    if (q.target === 'fiscal_reports' && has(q, 'eq', 'report_type', 'Z')) return { data: o.dernierZ ?? null };
    if (q.target === 'fiscal_reports') return { data: null };
    if (q.target === 'normalized_invoices' && has(q, 'eq', 'status', 'confirmed')) {
      return {
        data: [
          {
            id: 'f1',
            invoice_type: 'FV',
            status: 'confirmed',
            total_cents: '11600',
            vat_cents: '1600',
            computed_totals: { groupes: [{ groupe: 'B', taux: 16, totalCents: 11600, baseCents: 10000, tvaCents: 1600 }] },
            payments: [{ moyen: 'ESPECES', montantCents: 11600 }],
          },
        ],
      };
    }
    if (q.target === 'normalized_invoices' && has(q, 'in', 'status', ['provisional', 'pending', 'failed'])) return { data: [{ id: 'f2', invoice_type: 'FV', status: 'provisional' }] };
    if (q.target === 'normalized_invoices') return { data: { created_at: '2026-10-01T00:00:00Z' } };
    if (q.target === 'fiscal_profiles') return { data: { activated_at: '2026-10-01T00:00:00Z', trade_name: 'Supermarché Test' } };
    if (q.target === 'merchants') return { data: [{ id: 'm1' }] };
    if (q.target === 'cash_movements') return { data: [{ id: 'c1', type: 'cash_out', amount_cents: 5000, cash_register_sessions: { currency: 'CDF' } }] };
    if (q.target === 'normalized_invoice_items') return { data: [] };
    return { data: null };
  });
  const gestion = { droits: jest.fn(async () => o.droits ?? 'gestion') } as any;
  const factures = { profil: jest.fn(async () => ({ nif: 'A2216742Y', emcf_environment: 'test', emcf_nim: 'NIM-1' })), isf: () => 'SLP-SFE-01' } as any;
  return { svc: new RapportsFiscauxService(service, gestion, factures), queries, inseres };
}

const u = { id: 'u1', role: 'enterprise' };

describe('Rapports fiscaux (service)', () => {
  it('Z : numéro suivant, depuis la fin du dernier Z, figé avec les mentions de tête', async () => {
    const { svc, inseres, queries } = monter({ dernierZ: { seq: 3, period_end: FIN_Z3 } });
    const r = await svc.rapportZ(ORG, u);
    expect(inseres[0]).toMatchObject({ organization_id: ORG, report_type: 'Z', seq: 4, period_start: FIN_Z3 });
    expect(r).toMatchObject({ type: 'Z', seq: 4, duplicata: false, isf: 'SLP-SFE-01', nim: 'NIM-1' });
    expect(r.vendeur).toMatchObject({ denomination: 'Supermarché Test', nif: 'A2216742Y' });
    expect(r.ventes).toEqual({ nombre: 1, totalCents: 11600, tvaCents: 1600 });
    expect(r.incompletes).toMatchObject({ nombre: 1, provisoires: 1 });
    expect(r.especes).toEqual([{ devise: 'CDF', depotsCents: 0, retraitsCents: 5000 }]);
    // Seules les factures normalisées APRÈS le dernier Z comptent.
    const q = queries.find((x) => x.target === 'normalized_invoices' && has(x, 'eq', 'status', 'confirmed'))!;
    expect(has(q, 'gt', 'confirmed_at', FIN_Z3)).toBe(true);
  });

  it('premier Z : depuis l’activation, n° 1', async () => {
    const { svc, inseres } = monter({ dernierZ: null });
    await svc.rapportZ(ORG, u);
    expect(inseres[0]).toMatchObject({ seq: 1, period_start: '2026-10-01T00:00:00.000Z' });
  });

  it('le comptable lit et fait un X, mais ne clôture pas', async () => {
    const { svc, inseres } = monter({ droits: 'lecture' });
    await expect(svc.rapportZ(ORG, u)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.rapportA(ORG, u)).rejects.toBeInstanceOf(ForbiddenException);
    const x = await svc.rapportX(ORG, u);
    expect(x.type).toBe('X');
    expect(inseres.map((i) => [i.report_type, i.seq])).toEqual([['X', 0]]);
  });

  it('deux clôtures en même temps : la seconde est refusée', async () => {
    const { svc } = monter({ conflit: true, dernierZ: { seq: 3, period_end: FIN_Z3 } });
    await expect(svc.rapportZ(ORG, u)).rejects.toBeInstanceOf(ConflictException);
  });

  it('X périodique : dates dans l’ordre, un an au plus', async () => {
    const { svc } = monter();
    await expect(svc.rapportX(ORG, u, { debut: '2026-11-02T00:00:00Z', fin: '2026-11-01T00:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.rapportX(ORG, u, { debut: '2024-01-01T00:00:00Z', fin: '2026-11-01T00:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
    const r = await svc.rapportX(ORG, u, { debut: '2026-11-01T00:00:00Z', fin: '2026-11-02T00:00:00Z' });
    expect(r).toMatchObject({ type: 'XP', debut: '2026-11-01T00:00:00.000Z', fin: '2026-11-02T00:00:00.000Z' });
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplierNetworkService } from './supplier-network.service';
import { SupplierPlanService } from './supplier-plan.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const DAY = 86_400_000;

function setup(opts: { profile?: any; link?: any; staffStation?: string } = {}) {
  const writes: { table: string; payload: any }[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    const write = m('insert') || m('update');
    if (write) writes.push({ table: q.target, payload: write.args[0] });
    switch (q.target) {
      case 'supplier_profiles':
        if (m('insert')) return { data: { ...m('insert')!.args[0] } };
        return { data: opts.profile ?? null };
      case 'supplier_plan_settings':
        return { data: { trial_days: 4, annual_free_months: 2, reminder_days: [3] } };
      case 'supplier_plan_prices':
        return { data: [{ currency: 'USD', price_month_cents: 1000 }] };
      case 'supplier_links':
        if (m('insert') || m('update')) return { data: { id: 'k1', ...(opts.link || {}), ...write!.args[0] } };
        return { data: opts.link ?? null };
      case 'organization_staff':
        if (m('maybeSingle')) return { data: { merchant_id: opts.staffStation ?? 'm1', deactivated_at: null } };
        return { data: [] };
      default:
        return { data: null };
    }
  });
  const orgs = {
    getOrganizationById: jest.fn(async (id: string) => ({ id, name: id === 'cli' ? 'Client SARL' : 'Grossiste', owner_id: id === 'cli' ? 'cboss' : 'sboss' })),
    getOrganizationMerchants: jest.fn(async () => [{ id: 'm1', name: 'Dépôt' }]),
  };
  const notifications = { create: jest.fn(async () => undefined) };
  const plan = new SupplierPlanService(fake.service, notifications as any, {} as any, {} as any, {} as any);
  return { service: new SupplierNetworkService(fake.service, orgs as any, notifications as any, plan), writes, notifications };
}

const sboss = { id: 'sboss', role: 'enterprise' };
const cboss = { id: 'cboss', role: 'enterprise' };
const live = { organization_id: 'sup', supplier_number: 'F-123456', display_name: 'Grossiste', merchant_id: 'm1', active: true, trial_ends_at: new Date(Date.now() + DAY).toISOString(), plan_expires_at: null };
const ended = { ...live, trial_ends_at: new Date(Date.now() - DAY).toISOString() };

describe('supplier network', () => {
  it('only the owner becomes a supplier: a number F-xxxxxx, the trial of the super admin, and a notification saying so', async () => {
    const { service, writes, notifications } = setup();
    const res = await service.becomeSupplier('sup', sboss, { merchant_id: 'm1' });
    const row = writes.find((w) => w.table === 'supplier_profiles')!.payload;
    expect(row.supplier_number).toMatch(/^F-\d{6}$/);
    expect(new Date(row.trial_ends_at).getTime() - Date.now()).toBeGreaterThan(3.9 * DAY);
    expect(res.plan).toMatchObject({ status: 'trial', can_sell: true, trial_days_left: 4 });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'sboss', title: 'Essai gratuit Fournisseur : 4 jours' }));
    await expect(setup().service.becomeSupplier('sup', { id: 'g', role: 'gerant', organization_id: 'sup' }, { merchant_id: 'm1' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup().service.becomeSupplier('sup', sboss, { merchant_id: 'other' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a client invites a supplier by number; the supplier is told; refused when its plan has ended', async () => {
    const ok = setup({ profile: live });
    await ok.service.invite('cli', cboss, { supplier_number: 'f-123456' });
    expect(ok.writes.find((w) => w.table === 'supplier_links')!.payload).toMatchObject({ client_org_id: 'cli', supplier_org_id: 'sup', status: 'pending' });
    expect(ok.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'sboss', title: 'Nouvelle demande de client' }));
    await expect(setup({ profile: ended }).service.invite('cli', cboss, { supplier_number: 'F-123456' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only the supplier answers an invitation; accepting puts it in the client’s supplier list', async () => {
    const link = { id: 'k1', client_org_id: 'cli', supplier_org_id: 'sup', status: 'pending' };
    await expect(setup({ profile: live, link }).service.decideLink('cli', cboss, 'k1', 'accept')).rejects.toBeInstanceOf(ForbiddenException);
    const ok = setup({ profile: live, link });
    await ok.service.decideLink('sup', sboss, 'k1', 'accept');
    expect(ok.writes.find((w) => w.table === 'suppliers')!.payload).toMatchObject({ organization_id: 'cli', name: 'Grossiste', supplier_org_id: 'sup' });
  });

  it('a manager of another station cannot act for the supplier', async () => {
    const link = { id: 'k1', client_org_id: 'cli', supplier_org_id: 'sup', status: 'pending' };
    await expect(setup({ profile: live, link, staffStation: 'm2' }).service.decideLink('sup', { id: 'g', role: 'gerant', organization_id: 'sup' }, 'k1', 'accept'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrganizationStaffService } from './organization-staff.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const STAFF = { id: 'st1', user_id: 'emp-user', organization_id: 'org1', prenom: 'Jean', nom: 'Mukendi', email: 'j@x.com', deactivated_at: null };

function setup(opts: { staff?: any; currentRole?: string; markFails?: boolean; roleExists?: boolean } = {}) {
  const writes: { table: string; op: string; payload?: any }[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    if (q.target === 'organization_staff') {
      if (m('update')) { writes.push({ table: q.target, op: 'update', payload: m('update')!.args[0] }); return opts.markFails ? { error: { message: 'column deactivated_at does not exist' } } : { data: null }; }
      return { data: opts.staff === undefined ? STAFF : opts.staff };
    }
    if (q.target === 'roles') return opts.roleExists === false ? { data: null } : { data: { id: 'role-caissier', name: 'Caissier' } };
    if (q.target === 'user_roles') {
      if (m('delete')) { writes.push({ table: q.target, op: 'delete' }); return { data: null }; }
      if (m('insert')) { writes.push({ table: q.target, op: 'insert', payload: m('insert')!.args[0] }); return { data: null }; }
      return { data: { role: { slug: opts.currentRole ?? 'vendeur', name: 'Vendeur' } } };
    }
    if (q.target === 'profiles') { writes.push({ table: q.target, op: 'update', payload: m('update')?.args[0] }); return { data: null }; }
    return { data: null };
  });
  const updateUserById = jest.fn(async () => ({ error: null }));
  (fake.service.getClient() as any).auth = { admin: { updateUserById } };
  const audit = { log: jest.fn(async () => undefined) };
  const notifications = { create: jest.fn(async () => undefined) };
  const service = new OrganizationStaffService(fake.service, notifications as any, audit as any);
  return { service, writes, updateUserById, audit, notifications };
}

describe('changing an employee\'s role', () => {
  it('replaces the role, cuts their sessions, tells them, and writes who did it in the journal', async () => {
    const { service, writes, audit, notifications } = setup({ currentRole: 'vendeur' });
    await service.changeStaffRole('org1', 'st1', 'boss', 'caissier');
    expect(writes).toContainEqual({ table: 'user_roles', op: 'insert', payload: { user_id: 'emp-user', role_id: 'role-caissier', organization_id: 'org1' } });
    expect(writes).toContainEqual({ table: 'profiles', op: 'update', payload: { active_session_id: null, active_device_id: null } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss', action: 'staff_role_changed', changes: expect.objectContaining({ from: 'vendeur', to: 'caissier' }) }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'emp-user' }));
  });

  it('refuses a role that is not an employee role (no promoting someone to admin), the same role, or a removed account', async () => {
    await expect(setup().service.changeStaffRole('org1', 'st1', 'boss', 'super_admin')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().service.changeStaffRole('org1', 'st1', 'boss', 'enterprise')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ currentRole: 'caissier' }).service.changeStaffRole('org1', 'st1', 'boss', 'caissier')).rejects.toThrow(/déjà ce rôle/);
    await expect(setup({ staff: { ...STAFF, deactivated_at: '2026-01-01' } }).service.changeStaffRole('org1', 'st1', 'boss', 'caissier')).rejects.toThrow(/retiré/);
  });

  it('an employee of another organization is not found', async () => {
    await expect(setup({ staff: null }).service.changeStaffRole('org1', 'other', 'boss', 'caissier')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('removing an employee\'s access', () => {
  it('blocks the login, cuts the sessions, erases the temporary password and journals it', async () => {
    const { service, writes, updateUserById, audit } = setup();
    await service.deactivateStaff('org1', 'st1', 'boss');
    expect(updateUserById).toHaveBeenCalledWith('emp-user', expect.objectContaining({ ban_duration: expect.stringMatching(/h$/) }));
    expect(writes).toContainEqual({ table: 'profiles', op: 'update', payload: { active_session_id: null, active_device_id: null } });
    expect(writes.find((w) => w.table === 'organization_staff')!.payload).toMatchObject({ temp_password: null, deactivated_by: 'boss' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss', action: 'staff_access_removed' }));
  });

  it('still blocks the account if migration 051 is not applied (marking fails)', async () => {
    const { service, updateUserById, writes } = setup({ markFails: true });
    await expect(service.deactivateStaff('org1', 'st1', 'boss')).resolves.toEqual({ success: true });
    expect(updateUserById).toHaveBeenCalled();
    expect(writes).toContainEqual({ table: 'profiles', op: 'update', payload: { active_session_id: null, active_device_id: null } });
  });

  it('fails loudly (and does not claim success) when the account cannot be blocked', async () => {
    const { service, updateUserById } = setup();
    updateUserById.mockResolvedValueOnce({ error: { message: 'auth down' } } as any);
    await expect(service.deactivateStaff('org1', 'st1', 'boss')).rejects.toThrow(/block the account/);
  });

  it('restoring gives a new temporary password, forces a password change, and is journaled', async () => {
    const { service, updateUserById, audit, writes } = setup({ staff: { ...STAFF, deactivated_at: '2026-01-01' } });
    const r: any = await service.reactivateStaff('org1', 'st1', 'boss');
    expect(updateUserById).toHaveBeenCalledWith('emp-user', expect.objectContaining({ ban_duration: 'none' }));
    expect(r.temp_password).toHaveLength(10);
    expect(writes.find((w) => w.table === 'profiles')!.payload).toMatchObject({ must_change_password: true });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff_access_restored' }));
  });
});

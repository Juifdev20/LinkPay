import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { ProfilePhotosService } from './profile-photos.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const UID = '123e4567-e89b-12d3-a456-426614174000';
const OID = '223e4567-e89b-12d3-a456-426614174000';
const OLD_NAME = 'b'.repeat(32);
const publicUrl = (path: string) => `https://x.supabase.co/storage/v1/object/public/avatars/${path}`;
const picture = () => sharp({ create: { width: 600, height: 400, channels: 3, background: '#2b6' } }).jpeg().toBuffer();

type World = { avatar?: string | null; org?: any; staff?: any; updateError?: boolean; uploadError?: boolean };

function setup(w: World = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const isUpdate = has(q, 'update');
    if (q.target === 'profiles') return isUpdate ? { error: w.updateError ? { message: 'boom' } : null } : { data: { avatar_url: w.avatar ?? null } };
    if (q.target === 'organizations') return isUpdate ? { error: w.updateError ? { message: 'no column' } : null } : { data: w.org === undefined ? { id: OID, owner_id: 'owner-1', logo_url: null } : w.org };
    if (q.target === 'organization_staff') return { data: w.staff ?? null };
    return undefined;
  });
  const uploaded: { path: string; type: string; size: number }[] = [];
  const removed: string[][] = [];
  (fake.service.getClient() as any).storage = {
    from: (bucket: string) => {
      expect(bucket).toBe('avatars');
      return {
        upload: async (path: string, body: Buffer, opts: any) => {
          if (w.uploadError) return { error: { message: 'down' } };
          uploaded.push({ path, type: opts.contentType, size: body.length });
          return { error: null };
        },
        remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: publicUrl(path) } }),
      };
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  return { service: new ProfilePhotosService(fake.service, audit as any), fake, uploaded, removed, audit };
}

describe('profile photo (clients and merchants)', () => {
  it('stores a small WebP under an unguessable name and saves its address on the profile', async () => {
    const { service, uploaded, fake } = setup();
    const out = await service.setAvatar(UID, 'client', await picture());
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].path).toMatch(new RegExp(`^users/${UID}/[0-9a-f]{32}\\.webp$`));
    expect(uploaded[0].type).toBe('image/webp');
    expect(uploaded[0].size).toBeLessThan(30_000);
    expect(out.avatar_url).toBe(publicUrl(uploaded[0].path));
    const update = fake.queries.find((q) => q.target === 'profiles' && has(q, 'update'))!;
    expect(update.calls.find((c) => c.method === 'update')!.args[0].avatar_url).toBe(out.avatar_url);
  });

  it('a new photo deletes the previous file', async () => {
    const { service, removed } = setup({ avatar: publicUrl(`users/${UID}/${OLD_NAME}.webp`) });
    await service.setAvatar(UID, 'merchant', await picture());
    expect(removed).toEqual([[`users/${UID}/${OLD_NAME}.webp`]]);
  });

  it('removing the photo clears it and deletes the file', async () => {
    const { service, removed, fake } = setup({ avatar: publicUrl(`users/${UID}/${OLD_NAME}.webp`) });
    expect(await service.removeAvatar(UID, 'client')).toEqual({ avatar_url: null });
    expect(removed).toHaveLength(1);
    expect(fake.queries.some((q) => q.target === 'profiles' && has(q, 'update'))).toBe(true);
  });

  it('someone who works in a company cannot set a personal photo', async () => {
    for (const role of ['enterprise', 'gerant', 'caissier', 'vendeur', 'magasinier']) {
      const { service, uploaded } = setup();
      await expect(service.setAvatar(UID, role, await picture())).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.removeAvatar(UID, role)).rejects.toBeInstanceOf(ForbiddenException);
      expect(uploaded).toHaveLength(0);
    }
  });

  it('if the profile cannot be saved, the file just uploaded is deleted (nothing left behind)', async () => {
    const { service, uploaded, removed } = setup({ updateError: true });
    await expect(service.setAvatar(UID, 'client', await picture())).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(removed).toEqual([[uploaded[0].path]]);
  });

  it('a storage failure is a clear error, and the profile is left as it was', async () => {
    const { service, fake } = setup({ uploadError: true });
    await expect(service.setAvatar(UID, 'client', await picture())).rejects.toThrow('pas pu être enregistrée');
    expect(fake.queries.some((q) => q.target === 'profiles' && has(q, 'update'))).toBe(false);
  });

  it('a file that is not a picture is refused before anything is stored', async () => {
    const { service, uploaded } = setup();
    await expect(service.setAvatar(UID, 'client', Buffer.from('<svg/>'))).rejects.toThrow();
    expect(uploaded).toHaveLength(0);
  });
});

describe('company logo (managers only)', () => {
  it('the owner changes it; the old logo is deleted and the change is in the audit log', async () => {
    const { service, uploaded, removed, audit } = setup({ org: { id: OID, owner_id: 'owner-1', logo_url: publicUrl(`orgs/${OID}/${OLD_NAME}.webp`) } });
    const out = await service.setLogo(OID, 'owner-1', 'enterprise', OID, await picture());
    expect(uploaded[0].path).toMatch(new RegExp(`^orgs/${OID}/[0-9a-f]{32}\\.webp$`));
    expect(out.logo_url).toBe(publicUrl(uploaded[0].path));
    expect(removed).toEqual([[`orgs/${OID}/${OLD_NAME}.webp`]]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'owner-1', action: 'organization_logo_changed', entity_id: OID }));
  });

  it('an active gérant of the company changes it too', async () => {
    const { service, uploaded } = setup({ staff: { deactivated_at: null } });
    await service.setLogo(OID, 'gerant-1', 'gerant', OID, await picture());
    expect(uploaded).toHaveLength(1);
  });

  it('a cashier, a seller or a storekeeper cannot — nothing is stored', async () => {
    for (const role of ['caissier', 'vendeur', 'magasinier', 'comptable']) {
      const { service, uploaded } = setup({ staff: { deactivated_at: null } });
      await expect(service.setLogo(OID, 'staff-1', role, OID, await picture())).rejects.toThrow('Seul le responsable');
      await expect(service.removeLogo(OID, 'staff-1', role, OID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(uploaded).toHaveLength(0);
    }
  });

  it('a gérant who was deactivated, a gérant of ANOTHER company, and a stranger cannot', async () => {
    const stranger = setup();
    await expect(stranger.service.setLogo(OID, 'someone', 'client', undefined, await picture())).rejects.toBeInstanceOf(ForbiddenException);
    const otherCompany = setup({ staff: { deactivated_at: null } });
    await expect(otherCompany.service.setLogo(OID, 'g', 'gerant', 'another-org', await picture())).rejects.toBeInstanceOf(ForbiddenException);
    const fired = setup({ staff: { deactivated_at: '2026-10-01T00:00:00Z' } });
    await expect(fired.service.setLogo(OID, 'g', 'gerant', OID, await picture())).rejects.toBeInstanceOf(ForbiddenException);
    const noRow = setup({ staff: null });
    await expect(noRow.service.setLogo(OID, 'g', 'gerant', OID, await picture())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an unknown company is "not found"', async () => {
    const { service } = setup({ org: null });
    await expect(service.setLogo(OID, 'owner-1', 'enterprise', OID, await picture())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removing the logo clears it, deletes the file and is audited', async () => {
    const { service, removed, audit } = setup({ org: { id: OID, owner_id: 'owner-1', logo_url: publicUrl(`orgs/${OID}/${OLD_NAME}.webp`) } });
    expect(await service.removeLogo(OID, 'owner-1', 'enterprise', OID)).toEqual({ logo_url: null });
    expect(removed).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'organization_logo_removed' }));
  });

  it('if the logo cannot be saved (migration 089 missing), the uploaded file is deleted and the answer is clear', async () => {
    const { service, uploaded, removed } = setup({ updateError: true });
    await expect(service.setLogo(OID, 'owner-1', 'enterprise', OID, await picture())).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(removed).toEqual([[uploaded[0].path]]);
  });
});

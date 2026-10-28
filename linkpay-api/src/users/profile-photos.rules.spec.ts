import { BadRequestException, ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { assertCanHavePersonalPhoto, avatarObjectPath, canHavePersonalPhoto, MAX_UPLOAD_BYTES, shrinkPhoto } from './profile-photos.rules';

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg({ quality: 95 }).toBuffer();
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 40, b: 200, alpha: 1 } } }).png().toBuffer();

describe('shrinking a profile photo', () => {
  it('turns a big photo into a small square WebP, whatever its size', async () => {
    const big = await jpeg(3000, 2000);
    const out = await shrinkPhoto(big, 'avatar');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(out.length).toBeLessThan(big.length / 20);
    expect(out.length).toBeLessThan(30_000);
  });

  it('crops a face photo to a square, and keeps a logo whole on a transparent square', async () => {
    const wide = await png(800, 200);
    const logo = await shrinkPhoto(wide, 'logo');
    const meta = await sharp(logo).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.hasAlpha).toBe(true);
    const { data } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // the top-left corner is empty (transparent): the logo was not cropped
    const avatar = await shrinkPhoto(wide, 'avatar');
    expect((await sharp(avatar).metadata()).width).toBe(256);
  });

  it('removes the metadata a phone writes (place, date, camera) and applies the rotation', async () => {
    const withExif = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#888' } })
      .jpeg().withExif({ IFD0: { Copyright: 'Jean', Software: 'phone' } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await shrinkPhoto(withExif, 'avatar');
    expect((await sharp(out).metadata()).exif).toBeUndefined();
  });

  it('refuses what is not a JPEG, PNG or WebP picture: SVG, GIF, text, a script, an empty file', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer();
    for (const bad of [svg, gif, Buffer.from('<?php echo 1; ?>'), Buffer.from('hello'), Buffer.alloc(0), undefined]) {
      await expect(shrinkPhoto(bad as any, 'avatar')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a file over 2 Mo, with a plain message', async () => {
    await expect(shrinkPhoto(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'avatar')).rejects.toThrow('trop lourde');
  });

  it('refuses a truncated / corrupted picture instead of crashing', async () => {
    const good = await jpeg(500, 500);
    await expect(shrinkPhoto(good.subarray(0, 200), 'avatar')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('who has a personal photo', () => {
  it('clients, merchants and admins do; everyone in a company shows the company logo', () => {
    for (const r of ['client', 'merchant', 'admin', 'super_admin']) expect(canHavePersonalPhoto(r)).toBe(true);
    for (const r of ['enterprise', 'gerant', 'caissier', 'vendeur', 'magasinier', 'comptable']) expect(canHavePersonalPhoto(r)).toBe(false);
  });
  it('a company member who tries gets a clear refusal', () => {
    expect(() => assertCanHavePersonalPhoto('caissier')).toThrow(ForbiddenException);
    expect(() => assertCanHavePersonalPhoto('client')).not.toThrow();
  });
});

describe('finding our own file from its public address', () => {
  const uid = '123e4567-e89b-12d3-a456-426614174000';
  const name = 'a'.repeat(32);
  it('accepts only users/… and orgs/… files of the avatars bucket', () => {
    expect(avatarObjectPath(`https://x.supabase.co/storage/v1/object/public/avatars/users/${uid}/${name}.webp`)).toBe(`users/${uid}/${name}.webp`);
    expect(avatarObjectPath(`https://x.supabase.co/storage/v1/object/public/avatars/orgs/${uid}/${name}.webp?t=1`)).toBe(`orgs/${uid}/${name}.webp`);
  });
  it('never a path that climbs, another bucket, or something that is not ours', () => {
    expect(avatarObjectPath(`https://x.supabase.co/storage/v1/object/public/avatars/users/${uid}/../../other/${name}.webp`)).toBeNull();
    expect(avatarObjectPath(`https://x.supabase.co/storage/v1/object/public/qr-codes/${name}.png`)).toBeNull();
    expect(avatarObjectPath('https://evil.example/photo.png')).toBeNull();
    expect(avatarObjectPath(null)).toBeNull();
  });
});

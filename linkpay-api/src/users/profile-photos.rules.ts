import { BadRequestException, ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { ORG_STAFF_ROLES } from '../common/org-access';

/** What a person may send (the app shrinks it first; this is the ceiling for any other client). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp'];

export const AVATAR_PIXELS = 256;
export const LOGO_PIXELS = 512;

/** Roles whose face in the app is the company logo (changed by the managers only), not a personal photo. */
export const COMPANY_FACE_ROLES = ['enterprise', ...ORG_STAFF_ROLES];
/** The managers of a company: its owner, and its gérants. The other staff cannot change the logo. */
export const LOGO_MANAGER_STAFF_ROLES = ['gerant'];

export const canHavePersonalPhoto = (role?: string) => !COMPANY_FACE_ROLES.includes(role || '');

export type PhotoKind = 'avatar' | 'logo';

/**
 * Whatever picture was sent becomes a small WebP: turned upright (phones store the rotation in the file), cropped to a
 * square for a face, kept whole on a transparent square for a logo, and stripped of every piece of metadata (place,
 * date, camera). Anything that is not a JPEG, PNG or WebP picture is refused — an SVG or a GIF never gets in.
 */
export async function shrinkPhoto(input: Buffer | undefined, kind: PhotoKind): Promise<Buffer> {
  if (!input || !input.length) throw new BadRequestException('Aucune photo reçue.');
  if (input.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Cette photo est trop lourde (2 Mo au plus).');
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.format || !ACCEPTED_FORMATS.includes(meta.format)) {
      throw new BadRequestException('Format non accepté : choisissez une photo JPEG, PNG ou WebP.');
    }
    const size = kind === 'avatar' ? AVATAR_PIXELS : LOGO_PIXELS;
    const pipeline = image.rotate().resize(size, size, kind === 'avatar'
      ? { fit: 'cover', position: 'centre' }
      : { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    return await pipeline.webp({ quality: kind === 'avatar' ? 78 : 85, effort: 4 }).toBuffer();
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException("Cette image n'a pas pu être lue : choisissez une autre photo.");
  }
}

/** The object path inside the 'avatars' bucket of one of our public URLs, or null (not ours / not an avatar). */
export function avatarObjectPath(url?: string | null): string | null {
  if (!url) return null;
  const marker = '/object/public/avatars/';
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
  return /^(users|orgs)\/[0-9a-f-]{36}\/[0-9a-f]{32}\.webp$/.test(path) ? path : null;
}

export function assertCanHavePersonalPhoto(role?: string) {
  if (!canHavePersonalPhoto(role)) {
    throw new ForbiddenException("Dans une entreprise, l'image affichée est le logo de l'entreprise : il est changé par le responsable.");
  }
}

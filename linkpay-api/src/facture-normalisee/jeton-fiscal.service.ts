import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getRequiredJwtSecret } from '../auth/jwt-secret.util';

/**
 * Chiffrement du jeton e-MCF de chaque entreprise (AES-256-GCM), comme le secret de double authentification :
 * une copie de la base ne suffit pas à facturer au nom d'un client. Clé : FISCAL_TOKEN_ENCRYPTION_KEY (Render),
 * à défaut dérivée de JWT_SECRET. Le jeton en clair n'est jamais renvoyé par l'API, ni écrit dans un journal.
 */
@Injectable()
export class JetonFiscalService {
  private readonly cle: Buffer;

  constructor(config: ConfigService) {
    const matiere = config.get<string>('FISCAL_TOKEN_ENCRYPTION_KEY') || getRequiredJwtSecret(config);
    this.cle = createHash('sha256').update(`emcf:${matiere}`).digest();
  }

  chiffrer(jeton: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cle, iv);
    const ct = Buffer.concat([c.update(jeton, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }

  dechiffrer(stocke: string): string {
    const [version, iv, tag, ct] = (stocke ?? '').split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Jeton e-MCF illisible');
    const d = createDecipheriv('aes-256-gcm', this.cle, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  }

  /** Les 4 derniers caractères, pour reconnaître le jeton à l'écran sans le montrer. */
  indice(jeton: string): string {
    return jeton.trim().slice(-4);
  }
}

import { ConfigService } from '@nestjs/config';

/**
 * Reads JWT_SECRET from the environment and fails fast if it is missing or
 * too weak, instead of silently falling back to a hardcoded default (which
 * would let anyone forge valid tokens — including admin ones — against any
 * deployment that forgot to set the env var). Called at bootstrap (JwtModule
 * factory, JwtStrategy constructor) so a misconfigured deployment refuses to
 * start rather than serving requests with a known, guessable secret.
 */
export function getRequiredJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or too short (minimum 32 characters). Set a strong, random JWT_SECRET in the environment before starting the server.',
    );
  }
  return secret;
}

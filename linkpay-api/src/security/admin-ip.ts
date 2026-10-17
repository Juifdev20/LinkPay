/**
 * Optional network lock for administrators: when ADMIN_ALLOWED_IPS is set
 * (comma-separated), admin accounts only work from those addresses — an
 * attacker with a stolen password AND phone code still has to be on your
 * office network or VPN. Empty/unset = no restriction (admins on mobile data
 * change IP constantly, so it is opt-in).
 */
export function isAdminIpAllowed(allowList: string | undefined, ip: string | undefined): boolean {
  const list = (allowList || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return list.includes(normalized);
}

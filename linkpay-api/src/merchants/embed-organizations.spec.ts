import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Migrations 084/085 (supplier_profiles, supplier_stations) link merchants and organizations through a second path, so PostgREST refuses
 * an embed of `organizations` from `merchants` that does not name the foreign key ("more than one relationship was found"). This broke the
 * lookup by ScanLinkPay number on 23/10/2026. Every such embed must name `organizations!organization_id(...)`.
 */
describe('embedding organizations from merchants', () => {
  it.each(['merchants/merchants.service.ts', 'pos/pos.service.ts'])('%s names the foreign key', (file) => {
    const src = readFileSync(join(__dirname, '..', file), 'utf8');
    const embeds = src.match(/[\w:]*organizations(!\w+)?\(/g) ?? [];
    const merchantsEmbeds = embeds.filter((e) => /organizations/.test(e) && !/from\(/.test(e));
    expect(merchantsEmbeds.length).toBeGreaterThan(0);
    for (const e of merchantsEmbeds) expect(e).toMatch(/organizations!organization_id\($/);
  });
});

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobLockService } from '../common/job-lock/job-lock.service';
import { stationStaffWithRoles } from '../common/org-access';
import { ReportsService, StationReport } from './reports.service';

/** Kinshasa is UTC+1 all year (no daylight saving). */
const KINSHASA_OFFSET_MS = 60 * 60 * 1000;

/** [from, to) of the given Kinshasa calendar day, as UTC ISO strings, plus that day as YYYY-MM-DD. */
export function kinshasaDay(now = new Date()) {
  const local = new Date(now.getTime() + KINSHASA_OFFSET_MS);
  const day = local.toISOString().slice(0, 10);
  const from = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - KINSHASA_OFFSET_MS);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { day, from: from.toISOString(), to: to.toISOString() };
}

const fmt = (cents: number, currency: string) => {
  const units = (cents || 0) / 100;
  return currency === 'USD'
    ? `${units.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
    : `${Math.round(units).toLocaleString('fr-FR')} FC`;
};

/** One station's day in a line: "Station Goma : 120 000 FC (14 tickets), écart −2 000 FC". */
function stationLine(name: string, byCurrency: StationReport[]): string | null {
  const parts = byCurrency
    .filter((r) => r.totals.tickets || r.sessions.length)
    .map((r) => {
      const gap = r.sessions_total.discrepancy_cents;
      return `${fmt(r.totals.revenue_cents, r.currency)} (${r.totals.tickets} ticket${r.totals.tickets > 1 ? 's' : ''})${gap ? `, écart ${gap > 0 ? '+' : ''}${fmt(gap, r.currency)}` : ''}`;
    });
  return parts.length ? `${name} : ${parts.join(' · ')}` : null;
}

/**
 * Every evening at 21:00 (Kinshasa), each business owner gets ONE "Rapport
 * du jour" summing up all their stations, and each station manager the one
 * of their own station — takings, till discrepancies, stock-outs — with a
 * link to the full report. Stations without any activity that day are left out.
 */
@Injectable()
export class ReportsCronService {
  private readonly logger = new Logger(ReportsCronService.name);

  constructor(
    private supabaseService: SupabaseService,
    private reports: ReportsService,
    private notifications: NotificationsService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  @Cron('0 21 * * *', { timeZone: 'Africa/Kinshasa' })
  async sendDailyReports(now = new Date()): Promise<number> {
    if (this.jobLock && !(await this.jobLock.acquire('daily-station-reports', 3600))) return 0;
    const { day, from, to } = kinshasaDay(now);
    const db = this.supabaseService.getClient();

    const { data: orgs, error } = await db.from('organizations').select('id, name, owner_id').eq('status', 'active');
    if (error) {
      this.logger.error(`Daily reports: could not list organizations: ${error.message}`);
      return 0;
    }

    let sent = 0;
    for (const org of orgs || []) {
      try {
        const { data: stations } = await db.from('merchants').select('id, name').eq('organization_id', org.id);
        const ownerLines: string[] = [];
        let stockOuts = 0;
        for (const station of stations || []) {
          const byCurrency = await Promise.all((['CDF', 'USD'] as const).map((currency) =>
            this.reports.buildStationReport(station, { from, to, currency })));
          const line = stationLine(station.name, byCurrency);
          if (!line) continue;
          const outs = byCurrency[0].stock_alerts.filter((i) => i.quantity <= 0).length;
          stockOuts += outs;
          ownerLines.push(line);

          // The station's managers get their own station's day.
          const managers = await stationStaffWithRoles(db, station.id, ['gerant']);
          for (const userId of managers) {
            await this.notifications.create({
              user_id: userId,
              type: 'daily_report',
              title: `Rapport du jour — ${station.name}`,
              body: `${line}${outs ? ` · ${outs} produit(s) en rupture` : ''}.`,
              data: { date: day, merchant_id: station.id, url: `/dashboard/organization/reports?date=${day}&station=${station.id}` },
            }).catch(() => undefined);
            sent++;
          }
        }
        if (!ownerLines.length) continue;
        await this.notifications.create({
          user_id: org.owner_id,
          type: 'daily_report',
          title: `Rapport du jour — ${org.name}`,
          body: `${ownerLines.join(' ; ')}${stockOuts ? ` · ${stockOuts} produit(s) en rupture` : ''}.`,
          data: { date: day, organization_id: org.id, url: `/dashboard/organization/reports?date=${day}` },
        });
        sent++;
      } catch (err: any) {
        this.logger.warn(`Daily report failed for organization ${org.id}: ${err?.message || err}`);
      }
    }
    if (sent) this.logger.log(`Daily reports sent: ${sent} notification(s) for ${day}`);
    return sent;
  }
}

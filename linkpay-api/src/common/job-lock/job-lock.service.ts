import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * Makes a scheduled job run on ONE API instance per period (migration 053).
 *
 * Call `acquire('job-name', ttlSeconds)` first thing in the job and return if it says no.
 * Set the lease a little SHORTER than the job's period: nothing is released, the lease
 * simply runs out before the next run (a daily job: 1 hour is plenty; a job every minute: 50 s).
 *
 * If the lock can't be asked (migration 053 not applied yet, a database blip) the job runs
 * anyway: a missed reminder or payout reconciliation is worse than a duplicate, and each of
 * these jobs is already safe to run twice (atomic SQL, "already sent" markers).
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  /** Identifies this process in job_locks.locked_by (handy when debugging "who ran it"). */
  readonly instanceId = `${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'api'}-${randomUUID().slice(0, 8)}`;
  private warned = false;

  constructor(@Optional() private supabaseService?: SupabaseService) {}

  async acquire(name: string, ttlSeconds: number): Promise<boolean> {
    if (!this.supabaseService) return true;
    try {
      const { data, error } = await this.supabaseService.getClient().rpc('try_acquire_job_lock', {
        p_name: name,
        p_ttl_seconds: ttlSeconds,
        p_owner: this.instanceId,
      });
      if (error) {
        if (!this.warned) {
          this.warned = true;
          this.logger.warn(`Job locks unavailable (${error.message}) — running "${name}" without one. Apply migration 053.`);
        }
        return true;
      }
      if (data === false) this.logger.debug(`Job "${name}" is running on another instance — skipped here.`);
      return data !== false;
    } catch (err: any) {
      this.logger.warn(`Job lock check failed (${err?.message}) — running "${name}" without one.`);
      return true;
    }
  }
}

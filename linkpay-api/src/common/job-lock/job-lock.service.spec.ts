import { createFakeSupabase } from '../../test-utils/fake-supabase';
import { JobLockService } from './job-lock.service';

describe('JobLockService', () => {
  const make = (respond: (args: any) => any) => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:try_acquire_job_lock' ? respond(q.calls[0].args[0]) : { data: null }));
    return { service: new JobLockService(fake.service), fake };
  };

  it('runs the job when it wins the lease, asking with the job name, the ttl and its instance id', async () => {
    const { service, fake } = make(() => ({ data: true }));
    expect(await service.acquire('reminders', 3600)).toBe(true);
    expect(fake.queries[0].calls[0].args[0]).toMatchObject({ p_name: 'reminders', p_ttl_seconds: 3600, p_owner: service.instanceId });
  });

  it('skips the job when another instance holds the lease', async () => {
    expect(await make(() => ({ data: false })).service.acquire('reminders', 60)).toBe(false);
  });

  it('runs anyway when locks are unavailable (migration missing, database error) — never silently skips a job', async () => {
    expect(await make(() => ({ error: { message: 'function does not exist' } })).service.acquire('j', 60)).toBe(true);
    const throwing = make(() => { throw new Error('network'); });
    expect(await throwing.service.acquire('j', 60)).toBe(true);
  });

  it('works without a database (unit tests of other services)', async () => {
    expect(await new JobLockService().acquire('j', 60)).toBe(true);
  });
});

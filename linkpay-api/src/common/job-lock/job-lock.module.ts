import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { JobLockService } from './job-lock.service';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [JobLockService],
  exports: [JobLockService],
})
export class JobLockModule {}

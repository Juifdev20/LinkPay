import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { DeviceIntegrityController } from './device-integrity.controller';
import { DeviceIntegrityGuard } from './device-integrity.guard';
import { DeviceIntegrityService } from './device-integrity.service';

/** Global so the wallet endpoints can use @RequireDeviceIntegrity() without importing this module. */
@Global()
@Module({
  imports: [SupabaseModule],
  controllers: [DeviceIntegrityController],
  providers: [DeviceIntegrityService, DeviceIntegrityGuard],
  exports: [DeviceIntegrityService, DeviceIntegrityGuard],
})
export class DeviceIntegrityModule {}

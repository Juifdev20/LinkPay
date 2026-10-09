import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { SecurityAlertsService } from './security-alerts.service';
import { SecurityMonitorService } from './security-monitor.service';
import { TwoFactorService } from './two-factor.service';
import { OtpStepUpGuard } from './otp-step-up.guard';

/** Global: alerts and 2FA are needed from auth, wallets, risk, admin… without wiring imports everywhere. */
@Global()
@Module({
  imports: [SupabaseModule, NotificationsModule],
  providers: [LoginAttemptsService, TwoFactorService, SecurityAlertsService, SecurityMonitorService, OtpStepUpGuard],
  exports: [LoginAttemptsService, TwoFactorService, SecurityAlertsService, OtpStepUpGuard],
})
export class SecurityModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

// Modules
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MerchantsModule } from './merchants/merchants.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { OrganizationStaffModule } from './organization-staff/organization-staff.module';
import { StockModule } from './stock/stock.module';
import { PosModule } from './pos/pos.module';
import { CashRegisterModule } from './cash-register/cash-register.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentRequestsModule } from './payment-requests/payment-requests.module';
import { PaymentsModule } from './payments/payments.module';
import { TransactionsModule } from './transactions/transactions.module';
import { RefundsModule } from './refunds/refunds.module';
import { CommissionsModule } from './commissions/commissions.module';
import { SettlementsModule } from './settlements/settlements.module';
import { LedgerModule } from './ledger/ledger.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushNotificationsModule } from './push-notifications/push-notifications.module';
import { RiskModule } from './risk/risk.module';
import { SecurityModule } from './security/security.module';
import { AppCodeModule } from './app-code/app-code.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { WalletsModule } from './wallets/wallets.module';
import { WebauthnModule } from './webauthn/webauthn.module';
import { TontinesModule } from './tontines/tontines.module';
import { SavingsModule } from './savings/savings.module';
import { ExpenseTrackerModule } from './expense-tracker/expense-tracker.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { SalesModule } from './sales/sales.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CookieAuthInterceptor } from './auth/cookie-auth.interceptor';
import { AuthCookiesService } from './auth/auth-cookies';
import { JobLockModule } from './common/job-lock/job-lock.module';
import { DeviceIntegrityModule } from './integrity/device-integrity.module';
import { createThrottlerStorage } from './common/throttler/redis-throttler.storage';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Counters are shared across API instances when REDIS_URL is set, per instance otherwise.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        storage: createThrottlerStorage(config.get<string>('REDIS_URL')),
      }),
    }),
    JobLockModule,
    DeviceIntegrityModule,
    ScheduleModule.forRoot(),
    SupabaseModule,
    AuthModule,
    UsersModule,
    MerchantsModule,
    OrganizationsModule,
    OrganizationStaffModule,
    StockModule,
    PosModule,
    CashRegisterModule,
    InventoryModule,
    PaymentRequestsModule,
    PaymentsModule,
    TransactionsModule,
    RefundsModule,
    CommissionsModule,
    SettlementsModule,
    LedgerModule,
    WebhooksModule,
    NotificationsModule,
    PushNotificationsModule,
    RiskModule,
    SecurityModule,
    AppCodeModule,
    AdminModule,
    AuditModule,
    HealthModule,
    WalletsModule,
    WebauthnModule,
    TontinesModule,
    SavingsModule,
    ExpenseTrackerModule,
    PlatformSettingsModule,
    SalesModule,
    SubscriptionsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Browsers in cookie mode get their session in HttpOnly cookies, never in the response body.
    AuthCookiesService,
    { provide: APP_INTERCEPTOR, useClass: CookieAuthInterceptor },
  ],
})
export class AppModule {}

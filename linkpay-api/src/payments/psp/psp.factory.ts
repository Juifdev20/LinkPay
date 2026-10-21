import { Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PspAdapter } from './psp.adapter';
import { FlexPaieAdapter } from './providers/flexpaie.adapter';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class PspFactory implements OnModuleInit {
  private readonly logger = new Logger(PspFactory.name);
  private adapters = new Map<string, PspAdapter>();
  /** Connected to the "LinkPay Test" database (migration 071): no real money may land in it. */
  private testDatabase = false;

  constructor(
    private configService: ConfigService,
    private flexPaieAdapter: FlexPaieAdapter,
    @Optional() private supabaseService?: SupabaseService,
  ) {
    this.register('flexpaie', flexPaieAdapter);
  }

  register(provider: string, adapter: PspAdapter): void {
    this.adapters.set(provider, adapter);
    this.logger.log(`Registered PSP adapter: ${provider}`);
  }

  /**
   * The provider that moves REAL money. There is no simulated ("mock") provider any more and no default: without
   * PSP_PROVIDER set to a real provider, every payment, top-up and withdrawal is refused — never "succeeds" for free.
   * Test money is written by the developers directly in the database (docs/RECHARGE_TEST.md), never through the app.
   */
  /** Reads which database this API runs on (platform_environment, migration 071). */
  async onModuleInit(): Promise<void> {
    if (!this.supabaseService) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await this.supabaseService.getClient().from('platform_environment').select('name').maybeSingle();
      if (!error) {
        this.testDatabase = data?.name === 'test';
        this.logger.log(`Database: ${data?.name ?? 'production (not marked yet)'}${this.testDatabase ? ' — real payments are refused, test money only' : ''}`);
        return;
      }
      if (/platform_environment/i.test(error.message)) {
        this.logger.warn('platform_environment is missing (apply migration 071): taken as the production database');
        return;
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      else this.logger.error(`Could not read which database this is (${error.message}): taken as production`);
    }
  }

  get(provider?: string): PspAdapter {
    if (this.testDatabase) {
      throw new ServiceUnavailableException("Base de test : aucun paiement réel n'est possible ici. Argent de test : docs/BASE_TEST.md.");
    }
    const providerName = (provider || this.configService.get<string>('PSP_PROVIDER', '') || '').trim();
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      this.logger.error(providerName ? `PSP provider "${providerName}" is not available` : 'PSP_PROVIDER is not set: payments are refused');
      throw new ServiceUnavailableException('Les paiements sont momentanément indisponibles.');
    }
    return adapter;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}

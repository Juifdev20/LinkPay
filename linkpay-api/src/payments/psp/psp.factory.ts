import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PspAdapter } from './psp.adapter';
import { FlexPaieAdapter } from './providers/flexpaie.adapter';

@Injectable()
export class PspFactory {
  private readonly logger = new Logger(PspFactory.name);
  private adapters = new Map<string, PspAdapter>();

  constructor(
    private configService: ConfigService,
    private flexPaieAdapter: FlexPaieAdapter,
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
  get(provider?: string): PspAdapter {
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

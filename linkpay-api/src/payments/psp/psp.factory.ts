import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PspAdapter } from './psp.adapter';
import { MockPspAdapter } from './providers/mock.adapter';
import { CinetPayAdapter } from './providers/cinetpay.adapter';
import { FlexPaieAdapter } from './providers/flexpaie.adapter';

@Injectable()
export class PspFactory {
  private readonly logger = new Logger(PspFactory.name);
  private adapters = new Map<string, PspAdapter>();

  constructor(
    private configService: ConfigService,
    private mockAdapter: MockPspAdapter,
    private cinetPayAdapter: CinetPayAdapter,
    private flexPaieAdapter: FlexPaieAdapter,
  ) {
    this.register('mock', mockAdapter);
    this.register('cinetpay', cinetPayAdapter);
    this.register('flexpaie', flexPaieAdapter);
  }

  register(provider: string, adapter: PspAdapter): void {
    this.adapters.set(provider, adapter);
    this.logger.log(`Registered PSP adapter: ${provider}`);
  }

  get(provider?: string): PspAdapter {
    const providerName = provider || this.configService.get<string>('PSP_PROVIDER', 'mock');
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new Error(`PSP provider "${providerName}" not registered`);
    }
    return adapter;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}

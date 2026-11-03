import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { WalletsModule } from '../wallets/wallets.module';
import { FactureNormaliseeController, FactureNormaliseeVenteController } from './facture-normalisee.controller';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { GestionFiscaleService } from './gestion-fiscale.service';
import { JetonFiscalService } from './jeton-fiscal.service';
import { RapportsFiscauxController } from './rapports-fiscaux.controller';
import { RapportsFiscauxService } from './rapports-fiscaux.service';
import { RepriseFacturesService } from './reprise-factures.service';

/** Facture normalisée (DGI, e-MCF). Voir docs/FACTURE_NORMALISEE.md. */
@Module({
  imports: [SupabaseModule, StockModule, WalletsModule],
  controllers: [RapportsFiscauxController, FactureNormaliseeController, FactureNormaliseeVenteController],
  providers: [FactureNormaliseeService, GestionFiscaleService, JetonFiscalService, RepriseFacturesService, RapportsFiscauxService],
  exports: [FactureNormaliseeService, GestionFiscaleService],
})
export class FactureNormaliseeModule {}

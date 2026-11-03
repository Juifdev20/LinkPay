import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { JetonFiscalService } from './jeton-fiscal.service';
import { RepriseFacturesService } from './reprise-factures.service';

/**
 * Facture normalisée (DGI, e-MCF). Pas encore d'écrans ni de routes : ils viennent à l'étape 4
 * (paramètres fiscaux, caisse, ventes, impression). Voir docs/FACTURE_NORMALISEE.md.
 */
@Module({
  imports: [SupabaseModule],
  providers: [FactureNormaliseeService, JetonFiscalService, RepriseFacturesService],
  exports: [FactureNormaliseeService],
})
export class FactureNormaliseeModule {}

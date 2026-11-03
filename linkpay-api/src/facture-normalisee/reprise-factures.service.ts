import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { JobLockService } from '../common/job-lock/job-lock.service';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { GestionFiscaleService } from './gestion-fiscale.service';

/**
 * Chaque minute : normalise les bons provisoires (ventes faites sans réseau) et reprend les demandes restées sans
 * nouvelles, puis normalise les ventes payées restées sans facture. Une seule instance de l'API à la fois (verrou de tâche). Ne tourne que si FACTURE_NORMALISEE_ACTIVE=true :
 * tant que la migration 090 n'est pas appliquée et le service ouvert, rien ne se passe.
 */
@Injectable()
export class RepriseFacturesService {
  private readonly logger = new Logger(RepriseFacturesService.name);
  private enCours = false;

  constructor(
    private factures: FactureNormaliseeService,
    private gestion: GestionFiscaleService,
    private config: ConfigService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async executer(): Promise<{ essayees: number; confirmees: number }> {
    const rien = { essayees: 0, confirmees: 0 };
    if (this.enCours || this.config.get<string>('FACTURE_NORMALISEE_ACTIVE') !== 'true') return rien;
    if (this.jobLock && !(await this.jobLock.acquire('factures-normalisees-reprise', 50))) return rien;
    this.enCours = true;
    try {
      const r = await this.factures.reprendre();
      if (r.essayees) this.logger.log(`Reprise des factures normalisées : ${r.confirmees}/${r.essayees} confirmées`);
      // Ensuite, les ventes payées restées sans facture (bouton oublié, vente hors ligne synchronisée).
      const ramassees = await this.gestion.ramasser().catch((e) => {
        this.logger.warn(`Ventes sans facture normalisée : ${(e as Error).message}`);
        return 0;
      });
      if (ramassees) this.logger.log(`${ramassees} vente(s) payée(s) normalisée(s) automatiquement`);
      return r;
    } catch (e) {
      this.logger.error(`Reprise des factures normalisées impossible : ${(e as Error).message}`);
      return rien;
    } finally {
      this.enCours = false;
    }
  }
}

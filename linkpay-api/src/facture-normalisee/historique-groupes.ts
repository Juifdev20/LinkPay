import { Logger } from '@nestjs/common';

/**
 * Journal des changements de groupe de taxation (migration 094) : qui a changé quoi, quand, de quel groupe à quel groupe.
 * Ajout seul : la base refuse toute modification ou suppression d'une ligne.
 */
export type PorteeGroupe = 'product' | 'category' | 'default';

export interface ChangementGroupe {
  organizationId: string;
  scope: PorteeGroupe;
  subjectId?: string | null;
  subjectLabel?: string | null;
  ancien: string | null | undefined;
  nouveau: string | null | undefined;
  par: string | null | undefined;
}

const logger = new Logger('HistoriqueGroupes');
const propre = (g: string | null | undefined) => (g ? String(g).trim().toUpperCase() : null);

/** Écrit une ligne si le groupe a vraiment changé. Ne fait jamais échouer l'action de l'utilisateur, mais le dit dans les journaux. */
export async function journaliserGroupe(db: any, c: ChangementGroupe): Promise<void> {
  const ancien = propre(c.ancien);
  const nouveau = propre(c.nouveau);
  if (ancien === nouveau) return;
  try {
    const { error } = await db.from('fiscal_group_history').insert({
      organization_id: c.organizationId,
      scope: c.scope,
      subject_id: c.subjectId ?? null,
      subject_label: c.subjectLabel ?? null,
      old_group: ancien,
      new_group: nouveau,
      changed_by: c.par ?? null,
    });
    if (error) logger.error(`Journal des groupes non écrit (${c.scope} ${c.subjectId ?? ''}) : ${error.message}`);
  } catch (e) {
    logger.error(`Journal des groupes non écrit : ${(e as Error).message}`);
  }
}

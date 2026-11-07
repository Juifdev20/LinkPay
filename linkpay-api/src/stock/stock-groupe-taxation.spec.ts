import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStockItemDto } from './stock.controller';
import { champsFiscaux } from './stock.service';

const erreursGroupe = async (tax_group: unknown) => {
  const dto = plainToInstance(CreateStockItemDto, { name: 'Jus', tax_group, dgi_item_type: 'BIE', specific_tax_cents: null });
  return (await validate(dto)).filter((e) => e.property === 'tax_group');
};

describe('Fiche produit : groupe de taxation de la facture normalisée', () => {
  it("« Celui de la catégorie, sinon le groupe par défaut » (champ vide) est accepté et devient « pas de groupe propre »", async () => {
    expect(await erreursGroupe('')).toHaveLength(0);
    expect(await erreursGroupe(undefined)).toHaveLength(0);
    expect(await erreursGroupe(null)).toHaveLength(0);
    expect(champsFiscaux({ tax_group: '' }).tax_group).toBeNull();
  });

  it('une lettre de A à P est acceptée ; tout le reste est refusé', async () => {
    for (const g of ['A', 'B', 'K', 'P']) expect(await erreursGroupe(g)).toHaveLength(0);
    for (const g of ['Q', 'b', 'AB', '1', ' ']) expect(await erreursGroupe(g)).toHaveLength(1);
  });
});

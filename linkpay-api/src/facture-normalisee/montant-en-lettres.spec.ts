import { montantEnLettres, nombreEnLettres } from './montant-en-lettres';

describe('Montant en lettres (mention obligatoire de la facture normalisée)', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [21, 'vingt et un'],
    [43, 'quarante-trois'],
    [71, 'soixante et onze'],
    [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'],
    [101, 'cent un'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [280, 'deux cent quatre-vingts'],
    [1000, 'mille'],
    [1001, 'mille un'],
    [2000, 'deux mille'],
    [80000, 'quatre-vingt mille'],
    [200000, 'deux cent mille'],
    [1_000_000, 'un million'],
    [2_000_000, 'deux millions'],
    [200_000_000, 'deux cents millions'],
    [1_000_000_000, 'un milliard'],
    [
      243_828_497_218,
      'deux cent quarante-trois milliards huit cent vingt-huit millions quatre cent quatre-vingt-dix-sept mille deux cent dix-huit',
    ],
  ])('%d → %s', (n, attendu) => {
    expect(nombreEnLettres(n)).toBe(attendu);
  });

  it('écrit le total avec la devise et les centimes, première lettre en majuscule', () => {
    expect(montantEnLettres(1_160_050)).toBe('Onze mille six cents francs congolais et cinquante centimes');
    expect(montantEnLettres(100)).toBe('Un franc congolais');
    expect(montantEnLettres(1)).toBe('Zéro franc congolais et un centime');
    expect(montantEnLettres(100_000_000)).toBe('Un million de francs congolais');
    expect(montantEnLettres(1501, 'USD')).toBe('Quinze dollars américains et un cent');
  });

  it('refuse les montants négatifs ou non entiers', () => {
    expect(() => montantEnLettres(-1)).toThrow();
    expect(() => montantEnLettres(1.5)).toThrow();
  });
});

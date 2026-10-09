# Carte ScanLinkPay — proposition de design

Aperçu : `apercu-carte.html` (recto + verso), images `recto.png` / `verso.png`.
Données de l'aperçu **fictives** (nom, numéro, QR, téléphone du service client).

## Normes respectées
- **ISO/IEC 7810 ID-1** : 85,60 × 53,98 mm, angles arrondis de 3,18 mm.
- **ISO/IEC 7812** : numéro à 16 chiffres (4-4-4-4), dernier chiffre = clé de Luhn.
- **ISO/IEC 7813** : nom du titulaire en majuscules, date de validité MM/AA, ordre des informations comme une carte bancaire.
- **ISO/IEC 7811-2** : bande à 5,54–15,82 mm du bord haut au verso (ici imprimée, décorative).
- Texte le plus petit : 3,6 pt (libellés) ; texte courant ≥ 4,6 pt. Marges de sécurité 4,5 mm.
- Fichier d'impression : prévoir 1,5 mm de fond perdu de chaque côté (88,6 × 56,98 mm), PDF vectoriel, CMJN à faire valider par l'imprimeur.

## Charte reprise du projet
Bleu royal du logo (#1A3CFF → #0A17A8), « Pay » en bleu clair (#38B6FF), police Poppins, slogan « PAYEZ. RECEVEZ. SIMPLEMENT. », cadre de scan du logo autour du QR.

## Volontairement absent
- Pas de puce ni de symbole sans contact : la carte n'en a pas, les afficher tromperait les commerçants.
- Pas de solde imprimé : il change à chaque paiement, il se lit dans l'application.
- Pas de CVV : il n'aurait aucune fonction. Le PIN du portefeuille reste le secret.

# FlexPaie — ce qui est branché, ce qui ne l'est pas

Sources : « FlexPay — API de Paiement », version 2.0 (23/05/2026), et « Documentation FlexPaie Payout », version 1.03 (22/04/2024), remises par FlexPaie. Ces documents sont confidentiels : ils ne sont pas copiés dans le dépôt.

## Branché (`linkpay-api/src/payments/psp/providers/flexpaie.adapter.ts`)

| Besoin | Comment |
|---|---|
| **Recharge du portefeuille** et **paiement d'une facture** par Mobile Money | `POST /api/rest/v1/paymentService`, `type "1"` : FlexPaie envoie un message à valider sur le téléphone du client. L'application attend la confirmation sur sa page de résultat. |
| **Paiement par carte** (VISA…) | même appel, `type "2"` : FlexPaie donne une page de paiement, le client y est envoyé (https obligatoire), et revient sur la page de résultat quel que soit le résultat. |
| **Vérifier un paiement** | `GET /api/rest/v1/check/<orderNumber>` (statuts 0 payé, 1 échoué, 2 en attente, 3/4 remboursé, 5 annulé ; tout autre = on attend). |
| **Rappel (callback)** | Reçu sur `/api/v1/webhooks/flexpaie`. |
| **Retraits vers un numéro Mobile Money** | PayoutService (voir « Retraits automatiques » plus bas). |

## Pourquoi le rappel n'est jamais cru
Le document ne prévoit **aucune signature** sur le rappel. Il n'est donc qu'un signal : le statut et le montant sont **toujours relus chez FlexPaie**, avec le numéro de transaction **que nous avons enregistré** pour cette référence (table `flexpaie_orders`, migration `060`). Un rappel falsifié, ou qui désigne la transaction d'un autre paiement, est refusé. Le montant crédité est celui que FlexPaie confirme (`amount`, sans les frais payés par le client), et il doit être égal à celui que nous avions enregistré.

Comme le rappel peut se perdre et n'est pas renvoyé, une tâche de rattrapage interroge FlexPaie **chaque minute** pour tout paiement, recharge ou abonnement Pro resté « en attente » depuis plus de 45 secondes (jusqu'à 3 jours) et le règle comme le ferait le rappel (une seule fois, même si les deux se croisent).

## Pas branché : les documents ne le décrivent pas
- **Retraits vers un compte bancaire** : le PayoutService n'envoie que vers le Mobile Money (`type "1"`). Un retrait bancaire reste **traité à la main** (Administration → Retraits à traiter).
- Les **commerçants** n'ont pas besoin d'envoi séparé : depuis la migration 041, leur part de chaque vente arrive dans leur portefeuille, et ils retirent comme tout le monde.
- **Remboursement automatique** : aucun appel documenté (voir « Les trois remboursements »).

## Réponses de FlexPaie (oral, à confirmer par écrit)
- **Pas de sandbox** : les tests se font directement en production, avec de petits montants réels. Les options sensibles restent fermées par défaut (`PSP_PROVIDER`, `CARD_PAYMENTS_ENABLED`).
- **Frais** : envoi d'argent (payout) environ 2 %, encaissement (pay-in) environ 2,5 % (« souvent » : pas un tarif ferme ; 3 % observé par carte). Vérifier que nos frais de retrait (Administration → limites et frais) couvrent au moins 2 % plus une marge.
- **Adresses IP** : FlexPaie utilise ses propres adresses, sans configuration de notre côté : pas de proxy à acheter. `PROXY_URL` reste facultative. Les tests réels ont été faits depuis un PC, **pas depuis Render** : à valider au premier appel réel depuis Render.
- **Montant minimal** : **100 CDF** par opération — mesuré en production le 12 octobre 2026 (99 CDF refusé « Le montant est inférieur au montant minimal pour le CDF », 100 CDF accepté, canal carte ; Mobile Money supposé identique). En USD : inconnu, à mesurer. Le message de refus FlexPaie est renvoyé tel quel au payeur (400), il n'est plus masqué par « impossible d'initialiser le paiement ».
- **Rappel (callback) et codes d'erreur** : jugés couverts par la documentation (qui ne donne que les champs du résultat et un `code` 0/1 avec un message). Sans impact : le rappel n'est jamais cru, le statut est toujours relu par `check`.

## Les trois remboursements
Le mot recouvre trois situations différentes.
- **A. Un paiement entré par FlexPaie doit être rendu au client** (recharge ou facture payée par Mobile Money ou carte ; par exemple payé mais non crédité parce que le montant confirmé ne correspondait pas, ou payé par erreur). C'est **FlexPaie qui rembourse**, sur demande de ScanLinkPay : un administrateur leur envoie la référence, le numéro et le montant, ils vérifient que c'est remboursable puis remboursent. Procédure manuelle, aucun appel d'API (le `check` montre les statuts 3 « va être remboursé » et 4 « remboursé »).
- **B. Un retrait échoue ou est refusé** : rendu en interne. Le portefeuille est débité à la demande ; « Refuser » (ou un échec) rend montant **et** frais (`fail_withdrawal`). FlexPaie n'est pas concerné.
- **C. Un marchand rembourse un client sur une vente** : `RefundsService` déplace l'argent du portefeuille du marchand vers celui du client, en base. FlexPaie n'est pas concerné.

## À demander à FlexPaie
1. **Envoi d'argent (PayoutService)** : seulement les trois adresses de production et l'identifiant / mot de passe du module (le reste est tranché dans « Retraits automatiques », « Ce que la documentation ne dit pas »).
2. **Doublons** : une `reference` déjà utilisée est-elle refusée ? Peut-on interroger une transaction par notre référence ? (`check` ne marche que par `orderNumber` : si la réponse de la demande de paiement se perd, nous ne pouvons pas la retrouver.)
3. **Durée du message à valider** (Mobile Money) : au bout de combien de temps un paiement « en attente » (2) devient-il « échoué » (1) ?
4. **Règlement** : quand et comment l'argent encaissé arrive chez nous (délai, compte, relevé).
5. **Cartes acceptées** : le document ne cite que Visa, la page de test affiche aussi Mastercard, American Express et Diners Club ; cartes locales ou prépayées, et devises acceptées par carte.
6. Les **montants avec centimes** (USD) : par prudence, seuls les montants entiers sont acceptés pour l'instant.

## Variables (Render → linkpay-api → Environment) — liste complète dans `docs/RENDER_ENV.md`
Retraits automatiques : `FLEXPAIE_PAYOUT_AUTH_URL`, `FLEXPAIE_PAYOUT_URL`, `FLEXPAIE_PAYOUT_CHECK_URL`, `FLEXPAIE_PAYOUT_USERNAME`, `FLEXPAIE_PAYOUT_PASSWORD`, puis `FLEXPAIE_PAYOUTS_ENABLED=true` (voir « Retraits automatiques »).

`PSP_PROVIDER=flexpaie` (à ne mettre **qu'une fois les trois suivantes renseignées et le mode test essayé** : tant que `PSP_PROVIDER` n'est pas `flexpaie`, le code FlexPaie est inactif et ne change rien), `FLEXPAIE_MERCHANT`, `FLEXPAIE_TOKEN` et les adresses (et `PROXY_URL` si FlexPaie filtre l'IP). Jamais dans une conversation ni dans le dépôt.

**Production** (e-mail de FlexPaie du 9 octobre) : trois adresses complètes, car elles sont sur des serveurs différents :
- `FLEXPAIE_MOMO_URL` : l'adresse « Momo » (se termine par `/paymentService`) ;
- `FLEXPAIE_CARD_URL` : l'adresse « Carte » (idem) ;
- `FLEXPAIE_CHECK_URL` : `https://apicheck.flexpaie.com/api/rest/v1/check` (la fin `/ORDER_NUMBER_A_REMPLACER` de l'e-mail est tolérée, elle est retirée toute seule) ;
- `FLEXPAIE_MERCHANT` : le code marchand de production (pas celui du test) ; `FLEXPAIE_TOKEN` : le jeton Bearer (avec ou sans le mot `Bearer`).

`FLEXPAIE_BASE_URL` (un seul serveur pour tout, comme dans la documentation de test) reste utilisable : il sert pour chacune des trois adresses qui n'est pas renseignée. Tous ces serveurs passent par `PROXY_URL` quand il est défini.


## Numéro et opérateur (Mobile Money)
FlexPaie envoie la demande de confirmation **au numéro** : l'opérateur affiché à l'écran ne leur est pas transmis. Un client qui choisirait « Airtel Money » et saisirait un numéro M-Pesa recevrait donc la demande sur M-Pesa alors que nos écrans et nos comptes diraient Airtel. L'API (`linkpay-api/src/payments/mobile-money.ts`) et l'application (`linkpay-web/src/lib/mobile-money.ts`, mêmes tables) refusent donc un numéro d'un autre réseau que celui choisi, pour les recharges, les paiements de facture et les retraits.

| Réseau | Préfixes (après +243, ou 0 en national) |
|---|---|
| M-Pesa (Vodacom) | 81, 82, 83 |
| Orange Money | 80, 84, 85, 89 |
| Airtel Money | 97, 98, 99 |
| Africell (reconnu, pas encore proposé) | 90, 91 |

Un préfixe qui n'est pas dans ce tableau **n'est pas refusé** (FlexPaie reste juge) : une table incomplète ne doit pas bloquer de vrais clients. Les préfixes viennent de sources publiques qui concordent (pas de table officielle de l'ARPTC consultable) : à confirmer avec FlexPaie ou l'ARPTC, et à corriger dans les deux fichiers ci-dessus s'ils diffèrent.


## Retraits automatiques (PayoutService)
Source : documentation Payout v1.03. Code : fin de `flexpaie.adapter.ts`, `wallets/withdrawal-payout.service.ts`, journal `flexpaie_payouts` (migration `067`).

| Étape | Appel |
|---|---|
| Connexion | `POST <FLEXPAIE_PAYOUT_AUTH_URL>` `{username, password}` → `{code, token, expire_in}`. Le jeton est gardé jusqu'à une minute avant son expiration. |
| Envoi | `POST <FLEXPAIE_PAYOUT_URL>` `{merchant, type "1", reference, amount, currency, customer "243…", description, callback_url}` → `{code, status "0XX0".."0XX5", message, orderNumber}`. `reference` = `RET-<16 caractères>-<essai>` (22 à 25 caractères), nouvelle à chaque essai. |
| Vérification | `GET <FLEXPAIE_PAYOUT_CHECK_URL>/<orderNumber>` → `status` 0 envoyé, 1 échoué (mêmes codes que pour les paiements : 2 en cours, 3/4/5 non abouti). |
| Rappel | Reçu sur `/api/v1/webhooks/payouts/flexpaie` : jamais cru, il ne fait que déclencher la vérification. |

Un retrait Mobile Money :
1. débite le portefeuille (montant + frais, en une seule opération atomique) ;
2. est inscrit au journal **avant** l'envoi (une seule inscription possible par retrait : il ne peut pas partir deux fois) ;
3. est envoyé à FlexPaie. Selon la réponse :
   - **0XX0** (accepté) : le numéro de commande est gardé ; la vérification de chaque minute (et le rappel) termine le retrait : **effectué**, ou **échoué** et remboursé (montant + frais) ;
   - **0XX1** (un autre envoi est en cours) : rien n'est parti, le retrait reste en attente et repart à la minute suivante ; abandonné et remboursé après 24 h ;
   - **0XX2** (solde FlexPaie insuffisant), **0XX4** (jeton refusé deux fois), connexion refusée : remboursé tout de suite, le client lit « service momentanément indisponible », **les administrateurs reçoivent une alerte critique** (approvisionner le compte FlexPaie, vérifier les identifiants) ;
   - **0XX3** (numéro non pris en charge), **0XX5** (autre) : remboursé tout de suite avec le message ;
   - **pas de réponse** (délai dépassé, erreur 5xx) : l'argent est **peut-être parti**, le retrait n'est **ni renvoyé ni remboursé**. Le rappel de FlexPaie apporte le numéro de commande (vérifié chez FlexPaie avant d'être gardé) et la vérification conclut. **Sans aucune nouvelle au bout de 30 minutes, le retrait est remboursé.** Si FlexPaie annonce ensuite que l'argent est bien parti, une alerte critique « Retrait payé ET remboursé » est envoyée pour régulariser avec le client.

Les retraits demandés pendant la période manuelle et encore « en attente » au moment de l'activation **partent automatiquement** à la minute suivante. **Avant d'activer, vider la page « Retraits à traiter »** : un retrait déjà payé à la main mais pas encore marqué « J'ai envoyé » serait payé une seconde fois.

### Ce que la documentation ne dit pas : choix appliqués
Pratiques courantes des prestataires de paiement, sans attendre de réponse de FlexPaie :
- **Statut d'un envoi en cours** : la vérification des envois a la **même adresse** (`/api/rest/v1/check/<orderNumber>`) que celle des paiements ; on lit donc les mêmes codes : 0 envoyé, 2 en cours, 1/3/4/5 non abouti (remboursé), tout autre code = on attend (jamais un verdict).
- **Jeton de la vérification** : celui du PayoutService ; s'il est refusé, une nouvelle connexion, puis en dernier recours le jeton des paiements (`FLEXPAIE_TOKEN`).
- **Adresse de vérification** : `FLEXPAIE_PAYOUT_CHECK_URL` si FlexPaie en donne une, sinon celle des paiements (`FLEXPAIE_CHECK_URL`).
- **Doublons** : une **référence neuve à chaque essai** (`RET-…-1`, `RET-…-2`…). Un nouvel essai après « 0XX1 » n'est donc jamais refusé comme doublon. Le journal garde la référence de l'essai en cours, pour reconnaître le rappel.
- **Longueur de la référence** : 22 à 25 caractères, la forme des références que FlexPaie accepte déjà pour les paiements (`TOPUP-20261009-AB12CD`, 21).
- **Montants** : entiers seulement ; **minimum 100 CDF** (mesuré en production) et **1 USD** ; refusés **avant** de débiter le portefeuille. Les maximums sont les limites de retrait de l'administration (par opération, par jour, par mois). Si FlexPaie refuse un montant (0XX5), le retrait est remboursé avec son message.

### Sécurité (revue du 21/10/2026)
- **Personne ne peut déclarer un retrait payé ou échoué de l'extérieur** : le rappel n'est pas signé, il ne sert qu'à relire le statut chez FlexPaie, avec le numéro de commande que **nous** avons enregistré. Un numéro apporté par un rappel n'est gardé que si FlexPaie confirme notre référence, **le même montant et la même devise**.
- **Jamais deux envois pour un retrait** : inscription au journal avant l'envoi (une seule possible), pas de nouvel envoi tant que l'issue d'un envoi est inconnue.
- **Couper `FLEXPAIE_PAYOUTS_ENABLED`** n'abandonne rien : un retrait déjà confié à FlexPaie continue d'être vérifié jusqu'au bout et n'apparaît **pas** dans « Retraits à traiter » (un admin ne peut ni le rembourser ni le payer une seconde fois).
- **Montants** : entiers seulement (refusés dès la demande), minimums vérifiés avant tout débit.
- **Contrôle de risque** (cadence, nouveau portefeuille…) : s'il ne peut pas lire l'historique, **le retrait est refusé** (avant : il passait).
- **Pause de 24 h après un changement de clé** (migration `068`) : après un changement de mot de passe (y compris par le lien reçu par e-mail), de code PIN (y compris le premier), de numéro de téléphone ou d'e-mail, **aucun argent ne sort du compte pendant 24 h** : ni retrait, ni transfert, ni paiement d'un marchand par le portefeuille, ni remboursement par un marchand. Le transfert est inclus, sinon un voleur viderait le compte vers un autre portefeuille puis retirerait de là. La date est posée par des déclencheurs dans la base, donc aucun chemin n'y échappe.
- Déjà en place : code PIN (5 essais puis blocage), appareil vérifié, idempotence, débit atomique, limites par opération / jour / mois.
- **Risques connus et acceptés** : remboursement après 30 min sans nouvelles (si FlexPaie a quand même envoyé, alerte « Retrait payé ET remboursé ») ; anciens retraits envoyés à l'activation (vider la page avant). Ces deux cas coûtent à ScanLinkPay, jamais au client.

### Ce qui reste manuel
Les retraits **vers une banque**, et tous les retraits tant que `FLEXPAIE_PAYOUTS_ENABLED` n'est pas `true`, attendent un administrateur dans **Administration → Retraits à traiter** :
- **« J'ai envoyé »** (avec la référence du transfert si elle existe) : le retrait devient « effectué », le client est averti, les frais restent à ScanLinkPay ;
- **« Refuser »** (avec la raison) : le montant **et** les frais sont rendus au portefeuille, le client est averti avec la raison.

Règles de sécurité : le code de l'application d'authentification est demandé pour chaque décision ; un administrateur ne peut pas traiter un retrait de son propre portefeuille ; chaque décision est écrite dans le journal d'audit (`withdrawal_manual_sent`, `withdrawal_manual_rejected`) ; deux administrateurs qui cliquent en même temps ne règlent le retrait qu'une fois.

### Mise en service
1. Supabase → SQL Editor : exécuter `linkpay-api/supabase/migrations/067_flexpaie_payouts.sql`, puis `068_security_hold.sql` (**avant** le déploiement).
2. Déployer la nouvelle version de l'API (fusion dans `main`, Render redéploie `linkpay-api`). Sans `FLEXPAIE_PAYOUTS_ENABLED`, rien ne change : les retraits restent manuels.
3. Render → `linkpay-api` → Environment : les variables `FLEXPAIE_PAYOUT_*` (voir `docs/RENDER_ENV.md`), **sans** encore `FLEXPAIE_PAYOUTS_ENABLED`. Les adresses, l'identifiant et le mot de passe sont ceux que FlexPaie donne pour le PayoutService.
4. Vider la page « Retraits à traiter ».
5. Mettre `FLEXPAIE_PAYOUTS_ENABLED=true`, puis faire un retrait réel de 100 CDF vers un numéro de chaque réseau (M-Pesa, Orange, Airtel, Africell) et vérifier : argent reçu, retrait « effectué », notification.
6. En cas de problème : retirer `FLEXPAIE_PAYOUTS_ENABLED` (les nouveaux retraits redeviennent manuels ; ceux déjà envoyés continuent d'être vérifiés).

## Carte bancaire (Visa, Mastercard, American Express, Diners Club)
La page de paiement de FlexPaie affiche les logos Visa, Mastercard, American Express et Diners Club (constaté lors d'un test réel le 10 octobre 2026 ; la documentation v2.0 ne cite que Visa : cartes locales et prépayées à confirmer avec FlexPaie). Les frais de la carte sont à la charge du client : 100 CDF demandés → 103 CDF débités (environ 3 %), le portefeuille est crédité de 100.

Ce n'est **pas** la carte ScanLinkPay (docs/carte/) : c'est le moyen de **recharger son portefeuille avec la carte d'une banque**, via la page de paiement sécurisée de FlexPaie (type 2).

1. Dans « Recharger », la personne choisit **Carte bancaire** (aucun numéro de téléphone demandé) et confirme.
2. L'API crée la recharge « en attente » et demande à FlexPaie une page de paiement ; la personne y est envoyée. **Elle saisit les informations de sa carte chez FlexPaie : ScanLinkPay ne les voit, ne les reçoit et ne les stocke jamais.**
3. Quelle que soit l'issue (payé, annulé, refusé), la banque la renvoie vers `/payment/return?to=topup&ref=…`. Cette adresse **ne dit rien du résultat** : si la personne est connectée sur ce navigateur, elle est envoyée sur la page de résultat, qui interroge l'API ; sinon (application Android : la page de la banque s'ouvre dans le navigateur du téléphone, sans session) un message neutre l'invite à retourner dans l'application.
4. Le résultat n'est jamais cru sur parole : l'API demande à FlexPaie le statut de la commande enregistrée (page de résultat, rappel de FlexPaie qui n'est qu'un signal, et rattrapage automatique chaque minute). Seul un statut « payé » **avec le bon montant** crédite le portefeuille (le montant crédité est celui demandé, sans les frais de FlexPaie), une seule fois.

**Ouverture :** fermée par défaut. Elle s'ouvre avec `CARD_PAYMENTS_ENABLED=true` sur Render (avec `PSP_PROVIDER=flexpaie`), après ce test réel : recharge de 1000 CDF par carte, payée, puis une seconde annulée sur la page de la banque (le solde ne doit augmenter qu'une fois), puis une troisième avec le navigateur fermé en cours de route (le rattrapage doit la créditer en une minute). L'API refuse de toute façon une recharge par carte tant que l'option est fermée.

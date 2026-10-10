# FlexPaie — ce qui est branché, ce qui ne l'est pas

Source : « FlexPay — API de Paiement », version 2.0 (23/05/2026), remise par FlexPaie. Le document est confidentiel : il n'est pas copié dans le dépôt.

## Branché (`linkpay-api/src/payments/psp/providers/flexpaie.adapter.ts`)

| Besoin | Comment |
|---|---|
| **Recharge du portefeuille** et **paiement d'une facture** par Mobile Money | `POST /api/rest/v1/paymentService`, `type "1"` : FlexPaie envoie un message à valider sur le téléphone du client. L'application attend la confirmation sur sa page de résultat. |
| **Paiement par carte** (VISA…) | même appel, `type "2"` : FlexPaie donne une page de paiement, le client y est envoyé (https obligatoire), et revient sur la page de résultat quel que soit le résultat. |
| **Vérifier un paiement** | `GET /api/rest/v1/check/<orderNumber>` (statuts 0 payé, 1 échoué, 2 en attente, 3/4 remboursé, 5 annulé ; tout autre = on attend). |
| **Rappel (callback)** | Reçu sur `/api/v1/webhooks/flexpaie`. |

## Pourquoi le rappel n'est jamais cru
Le document ne prévoit **aucune signature** sur le rappel. Il n'est donc qu'un signal : le statut et le montant sont **toujours relus chez FlexPaie**, avec le numéro de transaction **que nous avons enregistré** pour cette référence (table `flexpaie_orders`, migration `060`). Un rappel falsifié, ou qui désigne la transaction d'un autre paiement, est refusé. Le montant crédité est celui que FlexPaie confirme (`amount`, sans les frais payés par le client), et il doit être égal à celui que nous avions enregistré.

Comme le rappel peut se perdre et n'est pas renvoyé, une tâche de rattrapage interroge FlexPaie **chaque minute** pour tout paiement, recharge ou abonnement Pro resté « en attente » depuis plus de 45 secondes (jusqu'à 3 jours) et le règle comme le ferait le rappel (une seule fois, même si les deux se croisent).

## Pas branché : le document ne le décrit pas
- **Retraits vers un numéro de téléphone** et **paiement des commerçants** : le journal des versions (v1.4, 2021) annonce un « module de paiement vers un numéro de téléphone pour les marchands », mais le document ne le décrit pas. Tant que nous n'avons pas cette partie, **tout retrait est refusé proprement** et l'argent reste dans le portefeuille.
- **Remboursement automatique** : aucun appel documenté. Les remboursements se font avec FlexPaie.

## À demander à FlexPaie
1. La documentation de l'API d'**envoi d'argent vers un numéro** (retraits, paiement des commerçants), avec le statut d'une opération et les erreurs.
2. Une adresse **https** (le document donne `http://ip:port` : le token circulerait en clair).
3. **Leur adresse IP source attendue** : si elle est filtrée, il faut une IP fixe (variable `PROXY_URL` de Render, déjà prise en charge pour l'adresse FlexPaie).
4. Le **format exact du rappel** (méthode, corps JSON ou formulaire) et s'il est **renvoyé** en cas d'échec.
5. **Qui paie les frais** : `amountCustomer` (ce que paie le client) est supérieur à `amount` (102 pour 100 dans leur exemple). Nous créditons `amount`.
6. Les **montants avec centimes** (USD) : par prudence, seuls les montants entiers sont acceptés pour l'instant.
7. Le **mode test** (sandbox), ses adresses et ses numéros de test.

## Variables (Render → linkpay-api → Environment) — liste complète dans `docs/RENDER_ENV.md`
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


## Retraits en attendant l'API d'envoi d'argent
FlexPaie n'a (pour l'instant) aucune API pour **envoyer** de l'argent. Quand `PSP_PROVIDER=flexpaie`, un retrait demandé dans l'application :
1. débite tout de suite le portefeuille (montant + frais, en une seule opération atomique) ;
2. reste **« en attente »** : rien n'est envoyé à FlexPaie, et la vérification automatique n'en conclut rien (elle ne le rembourse jamais d'elle-même) ;
3. apparaît dans **Administration → Retraits à traiter** (admin et super admin), avec le client, le montant à envoyer, les frais retenus, l'opérateur et le numéro (boutons « Copier »).

L'administrateur envoie l'argent à la main (Mobile Money de l'entreprise, ou l'interface FlexPaie si elle le permet), puis :
- **« J'ai envoyé »** (avec la référence du transfert si elle existe) : le retrait devient « effectué », le client est averti, les frais restent à ScanLinkPay ;
- **« Refuser »** (avec la raison) : le montant **et** les frais sont rendus au portefeuille, le client est averti avec la raison.

Règles de sécurité : le code de l'application d'authentification est demandé pour chaque décision ; un administrateur ne peut pas traiter un retrait de son propre portefeuille ; chaque décision est écrite dans le journal d'audit (`withdrawal_manual_sent`, `withdrawal_manual_rejected`) ; deux administrateurs qui cliquent en même temps ne règlent le retrait qu'une fois.

Dès que FlexPaie fournit son API d'envoi : il suffira de l'écrire dans `FlexPaieAdapter.payout()` / `getPayoutStatus()` et de retirer `supportsPayout = false` ; les retraits suivent alors le chemin automatique (ceux déjà en attente restent à traiter dans la page).


## Carte bancaire (Visa / Mastercard)
Ce n'est **pas** la carte ScanLinkPay (docs/carte/) : c'est le moyen de **recharger son portefeuille avec la carte d'une banque**, via la page de paiement sécurisée de FlexPaie (type 2).

1. Dans « Recharger », la personne choisit **Carte bancaire** (aucun numéro de téléphone demandé) et confirme.
2. L'API crée la recharge « en attente » et demande à FlexPaie une page de paiement ; la personne y est envoyée. **Elle saisit les informations de sa carte chez FlexPaie : ScanLinkPay ne les voit, ne les reçoit et ne les stocke jamais.**
3. Quelle que soit l'issue (payé, annulé, refusé), la banque la renvoie vers `/payment/return?to=topup&ref=…`. Cette adresse **ne dit rien du résultat** : si la personne est connectée sur ce navigateur, elle est envoyée sur la page de résultat, qui interroge l'API ; sinon (application Android : la page de la banque s'ouvre dans le navigateur du téléphone, sans session) un message neutre l'invite à retourner dans l'application.
4. Le résultat n'est jamais cru sur parole : l'API demande à FlexPaie le statut de la commande enregistrée (page de résultat, rappel de FlexPaie qui n'est qu'un signal, et rattrapage automatique chaque minute). Seul un statut « payé » **avec le bon montant** crédite le portefeuille (le montant crédité est celui demandé, sans les frais de FlexPaie), une seule fois.

**Ouverture :** fermée par défaut. Elle s'ouvre avec `CARD_PAYMENTS_ENABLED=true` sur Render (avec `PSP_PROVIDER=flexpaie`), après ce test réel : recharge de 1000 CDF par carte, payée, puis une seconde annulée sur la page de la banque (le solde ne doit augmenter qu'une fois), puis une troisième avec le navigateur fermé en cours de route (le rattrapage doit la créditer en une minute). L'API refuse de toute façon une recharge par carte tant que l'option est fermée.

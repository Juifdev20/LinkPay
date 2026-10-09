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

## Variables (Render → linkpay-api → Environment)
`PSP_PROVIDER=flexpaie`, `FLEXPAIE_BASE_URL`, `FLEXPAIE_MERCHANT`, `FLEXPAIE_TOKEN` (et `PROXY_URL` si FlexPaie filtre l'IP). Jamais dans une conversation ni dans le dépôt.

import { Link, useNavigate } from 'react-router-dom';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { SupportContactList } from '@/components/SupportContactList';

/** Date of the text below: change it with every change of the text. */
const UPDATED_ON = '22 octobre 2026';

/**
 * Politique de confidentialité, public page (Google Play asks for its address). Written from what the app really
 * collects (permissions, tables, partners) — when a feature starts collecting something new, this page changes too.
 */
export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  return (
    <PublicShell onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="md:max-w-3xl">
      <PublicCard className="space-y-6 text-sm leading-relaxed text-foreground">
        <header>
          <h1 className="text-2xl font-bold">Politique de confidentialité</h1>
          <p className="mt-1 text-muted-foreground">ScanLinkPay · mise à jour le {UPDATED_ON}</p>
        </header>

        <Section title="En bref">
          <p>
            ScanLinkPay est un portefeuille et un outil d'encaissement. Nous collectons ce qu'il faut pour ouvrir votre compte, faire
            circuler votre argent en sécurité et respecter la loi. Nous ne vendons pas vos données et nous ne les utilisons pas pour de
            la publicité.
          </p>
        </Section>

        <Section title="Ce que nous collectons">
          <List items={[
            <><b>Votre identité</b> : nom, numéro de téléphone, email (facultatif) et photo de profil si vous en ajoutez une.</>,
            <><b>Vos codes</b> : mot de passe, code PIN de transaction, code d'accès et code de secours. Ils sont enregistrés sous une forme
              chiffrée (empreinte) : personne chez ScanLinkPay ne peut les lire.</>,
            <><b>Votre argent</b> : solde, envois, réceptions, recharges, retraits, paiements, épargne, tontines, et les numéros
              Mobile Money que vous utilisez.</>,
            <><b>Ce que vous notez</b> : vos dépenses (« Mes dépenses ») et leurs catégories.</>,
            <><b>Pour les commerces et entreprises</b> : nom et adresse du commerce, identifiants légaux (RCCM, identification
              nationale), représentant légal, coordonnées de versement, logo, produits, stock, ventes et factures, et les nom,
              téléphone et email des employés que vous ajoutez.</>,
            <><b>La sécurité de votre compte</b> : l'appareil connecté, le type d'application (Android, Windows, navigateur), l'adresse
              IP et le navigateur lors des actions sensibles, et le résultat de la vérification d'intégrité de l'appareil (Google Play
              Integrity), pour bloquer les téléphones modifiés et les fraudes.</>,
            <><b>Les notifications</b> : un identifiant technique de votre téléphone, pour vous prévenir d'un paiement reçu.</>,
          ]} />
        </Section>

        <Section title="Ce que nous ne collectons pas">
          <List items={[
            <><b>Pas votre position</b>. Sur les anciens Android (10 et moins), le système demande la localisation pour chercher une
              imprimante Bluetooth : nous ne la lisons pas.</>,
            <><b>Pas vos photos</b>. L'appareil photo sert seulement à lire un QR code ou un code-barres ; rien n'est enregistré.</>,
            <><b>Pas votre empreinte ni votre visage</b>. Le déverrouillage biométrique reste dans votre téléphone ; nous ne recevons
              qu'une clé technique.</>,
            <><b>Pas votre numéro de carte bancaire</b>. Il est saisi chez notre partenaire de paiement, jamais chez nous.</>,
            <><b>Pas vos contacts</b>.</>,
          ]} />
        </Section>

        <Section title="Pourquoi">
          <List items={[
            'Faire fonctionner votre compte : envoyer, recevoir, payer, retirer, encaisser, gérer un commerce.',
            'Protéger votre argent : vérifier que c\'est bien vous, détecter les fraudes, prévenir en cas d\'activité inhabituelle.',
            'Respecter la loi : garder la trace des opérations financières et répondre aux autorités qui la demandent légalement.',
            'Vous prévenir : paiements reçus, retraits, invitations, sécurité.',
          ]} />
        </Section>

        <Section title="Avec qui nous les partageons">
          <p>Uniquement avec les prestataires nécessaires au service, chacun pour sa seule tâche :</p>
          <List items={[
            <><b>FlexPaie</b> : recharges, paiements et retraits par Mobile Money et par carte (votre numéro et le montant).</>,
            <><b>Supabase</b> et <b>Render</b> : hébergement de la base de données et des serveurs.</>,
            <><b>Google</b> : notifications sur Android (Firebase Cloud Messaging) et vérification d'intégrité (Play Integrity).</>,
            <><b>Resend</b>, <b>Africa's Talking</b> ou <b>Twilio</b> : alertes de sécurité par email ou SMS, envoyées aux administrateurs
              de ScanLinkPay.</>,
            <>Les <b>autorités</b> congolaises, seulement lorsque la loi nous y oblige.</>,
          ]} />
          <p>
            Quand vous payez ou envoyez de l'argent, la personne en face voit votre nom (ou celui de votre commerce) et votre numéro
            de portefeuille, comme sur un reçu.
          </p>
        </Section>

        <Section title="Sécurité">
          <p>
            Échanges chiffrés (HTTPS), codes enregistrés sous forme d'empreinte, double authentification pour les administrateurs,
            blocage après plusieurs codes faux, une seule session active par compte, et journal des actions sensibles.
          </p>
        </Section>

        <Section title="Combien de temps">
          <p>
            Vos données restent tant que votre compte existe. Quand vous le supprimez, votre nom, votre téléphone, votre email, votre
            photo, vos codes et vos appareils sont effacés. Les opérations financières sont gardées sans votre nom, pendant la durée
            exigée par la réglementation financière.
          </p>
        </Section>

        <Section title="Vos droits">
          <p>
            Vous pouvez consulter et corriger vos informations dans l'application (Profil, Paramètres), et supprimer votre compte à
            tout moment : <Link to="/supprimer-mon-compte" className="font-semibold text-primary underline underline-offset-2">supprimer mon compte</Link>.
            Pour toute autre demande, contactez-nous :
          </p>
          <SupportContactList />
        </Section>

        <Section title="Âge">
          <p>ScanLinkPay est réservé aux personnes majeures (18 ans et plus).</p>
        </Section>

        <Section title="Changements">
          <p>Si cette politique change, la date en haut de la page change aussi, et nous vous prévenons dans l'application pour tout changement important.</p>
        </Section>
      </PublicCard>
    </PublicShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-primary">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

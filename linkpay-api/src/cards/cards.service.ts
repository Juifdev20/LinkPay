import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import {
  expiryFor, formatCardNumber, generateCardNumber, generateQrToken, holderNameFor, isExpired, isQrToken, isValidCardNumber,
  maskCardNumber, normalizeCardNumber, publicHolderName,
} from './card-number';
import { CardSettings, DEFAULT_CARD_SETTINGS, validateCardSettings } from './card-settings';

export const LIVE_STATUSES = ['requested', 'issued', 'active', 'frozen'];
/** A merchant's charge waits this long for the holder to approve it. */
export const CHARGE_TTL_MINUTES = 3;
export const MAX_PENDING_CHARGES_PER_CARD = 3;
const MAX_ISSUE_RETRIES = 5;
const MAX_ACTIVATION_NOTE = 'card-activate';

/** The QR code holds a link ending in /c/<token>; a hand-typed token is accepted too. */
export function extractQrToken(scanned: string): string | null {
  const text = String(scanned ?? '').trim();
  const fromLink = /\/c\/([0-9A-Za-z]{12})(?:[/?#].*)?$/.exec(text);
  const candidate = (fromLink ? fromLink[1] : text).toUpperCase();
  return isQrToken(candidate) ? candidate : null;
}

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private walletsService: WalletsService,
    private walletPinService: WalletPinService,
    private loginAttempts: LoginAttemptsService,
    private notifications: NotificationsService,
    private audit: AuditService,
    private payments: PaymentsService,
    private paymentRequests: PaymentRequestsService,
    private config: ConfigService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ------------------------------------------------------------------ settings

  async getSettings(): Promise<CardSettings> {
    const { data, error } = await this.db.from('card_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return { ...DEFAULT_CARD_SETTINGS };
    return {
      service_phone: data.service_phone ?? null,
      web_domain: data.web_domain ?? null,
      validity_years: data.validity_years ?? DEFAULT_CARD_SETTINGS.validity_years,
      partner_logos: Array.isArray(data.partner_logos) ? data.partner_logos : [],
    };
  }

  async updateSettings(adminId: string, input: unknown): Promise<CardSettings> {
    const next = validateCardSettings(input);
    const before = await this.getSettings();
    const { error } = await this.db
      .from('card_settings')
      .upsert({ id: 1, ...next, updated_at: new Date().toISOString(), updated_by: adminId });
    if (error) throw new Error(`Failed to save the card settings: ${error.message}`);
    await this.audit.log({
      user_id: adminId,
      action: 'CARD_SETTINGS_UPDATED',
      entity_type: 'card_settings',
      entity_id: '1',
      // The logos are images: only say how many there were, not what they contain.
      changes: {
        before: { ...before, partner_logos: before.partner_logos.length },
        after: { ...next, partner_logos: next.partner_logos.length },
      },
    });
    return next;
  }

  /** The link the QR code opens. The domain is a super-admin setting; until it is set, the web app's own address is used. */
  qrUrl(token: string, settings: CardSettings): string {
    const base = settings.web_domain
      ? `https://${settings.web_domain}`
      : String(this.config.get<string>('FRONTEND_URL', 'http://localhost:5173')).replace(/\/+$/, '');
    return `${base}/c/${token}`;
  }

  // ------------------------------------------------------------------ the holder

  private async liveCard(userId: string) {
    const { data } = await this.db.from('cards').select('*').eq('user_id', userId).in('status', LIVE_STATUSES).maybeSingle();
    return data ?? null;
  }

  private effectiveStatus(card: any): string {
    return card.status === 'active' && isExpired(card.expires_on) ? 'expired' : card.status;
  }

  private ownerView(card: any, settings: CardSettings) {
    const shown = ['issued', 'active', 'frozen'].includes(card.status);
    return {
      id: card.id,
      status: this.effectiveStatus(card),
      serial_no: card.serial_no,
      holder_name: card.holder_name,
      expires_on: card.expires_on,
      issued_at: card.issued_at,
      activated_at: card.activated_at,
      blocked_reason: card.blocked_reason,
      card_number: shown ? card.card_number : null,
      card_number_masked: maskCardNumber(card.card_number),
      qr_url: shown && card.qr_token ? this.qrUrl(card.qr_token, settings) : null,
    };
  }

  /** The person's card (the living one, else the last one) with the balances of their wallet, and what the card shows on its back. */
  async getMyCard(userId: string) {
    const settings = await this.getSettings();
    const live = await this.liveCard(userId);
    let card = live;
    if (!card) {
      const { data } = await this.db.from('cards').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      card = data ?? null;
    }
    let balances = { CDF: 0, USD: 0 };
    try {
      balances = (await this.walletsService.getMyWallet(userId)).balances;
    } catch {
      // No wallet yet: zero balances, and the request below will explain.
    }
    return {
      card: card ? this.ownerView(card, settings) : null,
      can_request: !live,
      balances,
      display: { service_phone: settings.service_phone, web_domain: settings.web_domain, partner_logos: settings.partner_logos },
    };
  }

  async requestCard(userId: string) {
    const { data: wallet } = await this.db.from('wallets').select('id, status').eq('user_id', userId).maybeSingle();
    if (!wallet) throw new NotFoundException('Portefeuille introuvable.');
    if (wallet.status !== 'ACTIVE') throw new BadRequestException(`Votre portefeuille est ${wallet.status} : carte impossible.`);
    const { data, error } = await this.db.from('cards').insert({ user_id: userId, wallet_id: wallet.id, status: 'requested' }).select().single();
    if (error) {
      if ((error as any).code === '23505') throw new ConflictException('Vous avez déjà une carte ou une demande en cours.');
      throw new Error(`Failed to request a card: ${error.message}`);
    }
    await this.audit.log({ user_id: userId, action: 'CARD_REQUESTED', entity_type: 'card', entity_id: data.id });
    return { id: data.id, status: data.status };
  }

  /**
   * The holder proves they have the card in hand: the 16 digits printed on it AND their PIN. A card given to
   * the wrong person is useless: it can only be activated from the account it belongs to.
   */
  async activate(userId: string, cardNumberInput: string, pin: string) {
    const card = await this.liveCard(userId);
    if (!card || card.status !== 'issued') throw new BadRequestException("Aucune carte à activer sur ce compte.");
    if (isExpired(card.expires_on)) throw new BadRequestException('Cette carte est expirée. Demandez-en une nouvelle.');

    const key = `${MAX_ACTIVATION_NOTE}:${userId}`;
    await this.loginAttempts.reserve(key); // counted BEFORE the number is compared; throws 429 once locked
    const typed = normalizeCardNumber(cardNumberInput);
    const a = Buffer.from(typed.padEnd(16, '#').slice(0, 16));
    const b = Buffer.from(String(card.card_number));
    if (!isValidCardNumber(typed) || !timingSafeEqual(a, b)) {
      throw new BadRequestException("Ce numéro ne correspond pas à votre carte. Vérifiez les 16 chiffres inscrits sur la carte.");
    }
    await this.walletPinService.verifyPin(userId, pin);
    await this.loginAttempts.recordSuccess(key);

    const { data, error } = await this.db
      .from('cards')
      .update({ status: 'active', activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', card.id)
      .eq('status', 'issued')
      .select()
      .maybeSingle();
    if (error || !data) throw new ConflictException("La carte n'a pas pu être activée. Réessayez.");
    await this.audit.log({ user_id: userId, action: 'CARD_ACTIVATED', entity_type: 'card', entity_id: card.id });
    return { status: 'active' };
  }

  async freeze(userId: string) {
    const card = await this.liveCard(userId);
    if (!card || card.status !== 'active') throw new BadRequestException("Seule une carte active peut être mise en pause.");
    await this.setStatus(card.id, 'frozen', 'active');
    await this.cancelOpenCharges(card.id);
    await this.audit.log({ user_id: userId, action: 'CARD_FROZEN', entity_type: 'card', entity_id: card.id });
    return { status: 'frozen' };
  }

  async unfreeze(userId: string, pin: string) {
    const card = await this.liveCard(userId);
    if (!card || card.status !== 'frozen') throw new BadRequestException("Votre carte n'est pas en pause.");
    await this.walletPinService.verifyPin(userId, pin);
    await this.setStatus(card.id, 'active', 'frozen');
    await this.audit.log({ user_id: userId, action: 'CARD_UNFROZEN', entity_type: 'card', entity_id: card.id });
    return { status: 'active' };
  }

  /** Lost or stolen: final. The PIN is asked so that someone holding an unlocked phone can't kill the owner's card for fun. */
  async reportLost(userId: string, pin: string) {
    const card = await this.liveCard(userId);
    if (!card || card.status === 'requested') throw new BadRequestException("Vous n'avez pas de carte à déclarer.");
    await this.walletPinService.verifyPin(userId, pin);
    await this.block(card, 'lost');
    await this.audit.log({ user_id: userId, action: 'CARD_REPORTED_LOST', entity_type: 'card', entity_id: card.id });
    return { status: 'blocked' };
  }

  private async setStatus(cardId: string, to: string, from: string) {
    const { data, error } = await this.db
      .from('cards').update({ status: to, updated_at: new Date().toISOString() }).eq('id', cardId).eq('status', from).select('id').maybeSingle();
    if (error || !data) throw new ConflictException('Le statut de la carte a changé entre-temps. Réessayez.');
  }

  private async block(card: any, reason: string) {
    const { error } = await this.db
      .from('cards')
      .update({ status: 'blocked', blocked_reason: reason, blocked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', card.id)
      .in('status', LIVE_STATUSES);
    if (error) throw new Error(`Failed to block the card: ${error.message}`);
    await this.cancelOpenCharges(card.id);
  }

  /** Anything a merchant was waiting to be paid with this card is void. */
  private async cancelOpenCharges(cardId: string) {
    const { data: open } = await this.db
      .from('card_charges').select('id, payment_request_id').eq('card_id', cardId).in('status', ['pending', 'processing']);
    for (const c of open ?? []) {
      await this.db.from('card_charges').update({ status: 'cancelled', decided_at: new Date().toISOString() }).eq('id', c.id).in('status', ['pending', 'processing']);
      await this.db.from('payment_requests').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', c.payment_request_id).eq('status', 'CREATED');
    }
  }

  /** What a logged-in person learns from a card they scanned: who it is (first name + initial) and where to send money. */
  async resolveForSend(token: string) {
    const clean = extractQrToken(token);
    const { data: card } = clean ? await this.db.from('cards').select('*').eq('qr_token', clean).maybeSingle() : { data: null };
    if (!card || card.status !== 'active' || isExpired(card.expires_on)) throw new NotFoundException('Carte introuvable ou non activée.');
    const [{ data: wallet }, { data: profile }] = await Promise.all([
      this.db.from('wallets').select('wallet_number').eq('id', card.wallet_id).maybeSingle(),
      this.db.from('profiles').select('full_name').eq('id', card.user_id).maybeSingle(),
    ]);
    if (!wallet) throw new NotFoundException('Carte introuvable ou non activée.');
    return { holder: publicHolderName(profile?.full_name), wallet_number: wallet.wallet_number };
  }

  // ------------------------------------------------------------------ the super admin

  async adminList(filters: { status?: string; q?: string; page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    let query = this.db.from('cards').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);

    const q = (filters.q ?? '').trim();
    if (q) {
      const digits = normalizeCardNumber(q);
      const userIds = new Set<string>();
      const [{ data: byWallet }, { data: byProfile }] = await Promise.all([
        this.db.from('wallets').select('user_id').ilike('wallet_number', `%${q.replace(/[%,()]/g, '')}%`).limit(50),
        this.db.from('profiles').select('id').or(`full_name.ilike.%${q.replace(/[%,()]/g, '')}%,email.ilike.%${q.replace(/[%,()]/g, '')}%`).limit(50),
      ]);
      (byWallet ?? []).forEach((w: any) => userIds.add(w.user_id));
      (byProfile ?? []).forEach((p: any) => userIds.add(p.id));
      const clauses: string[] = [];
      if (userIds.size) clauses.push(`user_id.in.(${[...userIds].join(',')})`);
      if (/^\d{4,16}$/.test(digits)) clauses.push(digits.length === 16 ? `card_number.eq.${digits}` : `card_number.like.%${digits}`);
      if (clauses.length === 0) return { data: [], total: 0, page, limit };
      query = query.or(clauses.join(','));
    }

    const { data: cards, error, count } = await query.range((page - 1) * limit, page * limit - 1);
    if (error) throw new Error(`Failed to list cards: ${error.message}`);

    const ids = [...new Set((cards ?? []).map((c: any) => c.user_id))];
    const [{ data: profiles }, { data: wallets }] = ids.length
      ? await Promise.all([
          this.db.from('profiles').select('id, full_name, email').in('id', ids),
          this.db.from('wallets').select('user_id, wallet_number').in('user_id', ids),
        ])
      : [{ data: [] }, { data: [] }];
    const profileOf = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const walletOf = new Map((wallets ?? []).map((w: any) => [w.user_id, w.wallet_number]));

    return {
      data: (cards ?? []).map((c: any) => ({
        id: c.id,
        serial_no: c.serial_no,
        status: this.effectiveStatus(c),
        holder_name: c.holder_name,
        full_name: (profileOf.get(c.user_id) as any)?.full_name ?? null,
        email: (profileOf.get(c.user_id) as any)?.email ?? null,
        wallet_number: walletOf.get(c.user_id) ?? null,
        card_number_masked: maskCardNumber(c.card_number),
        expires_on: c.expires_on,
        print_count: c.print_count,
        blocked_reason: c.blocked_reason,
        created_at: c.created_at,
        issued_at: c.issued_at,
      })),
      total: count || 0,
      page,
      limit,
    };
  }

  /**
   * Prepares a card: from the ScanLinkPay number of the person (the counter case: they walk in, we type their
   * number) or from a request they made in the app. The card is NOT usable until the holder activates it.
   */
  async issue(adminId: string, input: { wallet_number?: string; card_id?: string; replace?: boolean }) {
    let wallet: any = null;
    if (input.card_id) {
      const { data: card } = await this.db.from('cards').select('wallet_id, status').eq('id', input.card_id).maybeSingle();
      if (!card) throw new NotFoundException('Demande introuvable.');
      if (card.status !== 'requested') throw new BadRequestException("Cette demande n'est plus en attente.");
      ({ data: wallet } = await this.db.from('wallets').select('id, user_id, wallet_number, status').eq('id', card.wallet_id).maybeSingle());
    } else if (input.wallet_number) {
      ({ data: wallet } = await this.db
        .from('wallets').select('id, user_id, wallet_number, status').eq('wallet_number', input.wallet_number.trim().toUpperCase()).maybeSingle());
    } else {
      throw new BadRequestException('Indiquez le numéro ScanLinkPay de la personne.');
    }
    if (!wallet) throw new NotFoundException('Aucun portefeuille avec ce numéro ScanLinkPay.');
    if (wallet.status !== 'ACTIVE') throw new BadRequestException(`Ce portefeuille est ${wallet.status} : carte impossible.`);

    const [{ data: profile }, settings] = await Promise.all([
      this.db.from('profiles').select('full_name, email').eq('id', wallet.user_id).maybeSingle(),
      this.getSettings(),
    ]);
    const holder = holderNameFor(profile?.full_name, profile?.email);
    const expiresOn = expiryFor(new Date(), settings.validity_years);

    let issued: any = null;
    for (let attempt = 0; attempt < MAX_ISSUE_RETRIES && !issued; attempt++) {
      const { data, error } = await this.db.rpc('issue_card', {
        p_user: wallet.user_id,
        p_wallet: wallet.id,
        p_holder_name: holder,
        p_card_number: generateCardNumber(),
        p_qr_token: generateQrToken(),
        p_expires_on: expiresOn,
        p_admin: adminId,
        p_replace: !!input.replace,
      });
      if (!error) {
        issued = Array.isArray(data) ? data[0] : data;
        break;
      }
      const message = String((error as any).message || '');
      if (message.includes('CARD_ALREADY_EXISTS')) {
        throw new ConflictException('Cette personne a déjà une carte. Choisissez « remplacer » pour en émettre une nouvelle (l\'ancienne sera désactivée).');
      }
      if (message.includes('CARD_WALLET_MISMATCH')) throw new BadRequestException('Portefeuille incohérent.');
      // A number or a token that already exists (a one-in-a-billion draw): draw again.
      if ((error as any).code !== '23505') throw new Error(`Failed to issue the card: ${message}`);
    }
    if (!issued) throw new Error('Failed to issue the card: could not find a free number');

    await this.audit.log({
      user_id: adminId,
      action: input.replace ? 'CARD_REPLACED' : 'CARD_ISSUED',
      entity_type: 'card',
      entity_id: issued.id,
      changes: { wallet_number: wallet.wallet_number, card_number: maskCardNumber(issued.card_number) },
    });
    await this.notifications.create({
      user_id: wallet.user_id,
      type: 'card',
      title: 'Votre carte ScanLinkPay est prête',
      body: "Récupérez-la, puis activez-la dans l'application (menu Ma carte) avec les 16 chiffres inscrits dessus et votre PIN.",
      data: { card_id: issued.id },
    });
    return { id: issued.id, serial_no: issued.serial_no, status: issued.status, wallet_number: wallet.wallet_number, holder_name: issued.holder_name };
  }

  /** Everything the print view needs. Only a card that is waiting to be handed over can be printed. */
  async printData(adminId: string, cardId: string) {
    const { data: card } = await this.db.from('cards').select('*').eq('id', cardId).maybeSingle();
    if (!card) throw new NotFoundException('Carte introuvable.');
    if (card.status !== 'issued') {
      throw new BadRequestException(card.status === 'requested' ? "Émettez d'abord la carte." : "Seule une carte émise et pas encore activée peut être imprimée.");
    }
    const settings = await this.getSettings();
    await this.db.from('cards').update({ print_count: (card.print_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq('id', card.id);
    await this.audit.log({ user_id: adminId, action: 'CARD_PRINTED', entity_type: 'card', entity_id: card.id, changes: { print_count: (card.print_count ?? 0) + 1 } });
    return {
      id: card.id,
      serial_no: card.serial_no,
      card_number: card.card_number,
      card_number_formatted: formatCardNumber(card.card_number),
      holder_name: card.holder_name,
      expires_on: card.expires_on,
      qr_url: this.qrUrl(card.qr_token, settings),
      settings,
    };
  }

  async adminBlock(adminId: string, cardId: string, reason: string) {
    const { data: card } = await this.db.from('cards').select('*').eq('id', cardId).maybeSingle();
    if (!card) throw new NotFoundException('Carte introuvable.');
    if (!LIVE_STATUSES.includes(card.status)) throw new BadRequestException('Cette carte est déjà bloquée ou remplacée.');
    await this.block(card, reason);
    await this.audit.log({ user_id: adminId, action: 'CARD_BLOCKED', entity_type: 'card', entity_id: card.id, changes: { reason } });
    await this.notifications.create({
      user_id: card.user_id,
      type: 'card',
      title: 'Votre carte a été bloquée',
      body: 'Votre carte ScanLinkPay ne peut plus être utilisée. Contactez le support pour en obtenir une nouvelle.',
      data: { card_id: card.id },
    });
    return { status: 'blocked' };
  }

  // ------------------------------------------------------------------ paying with the card

  /**
   * A merchant scanned a card (or typed its number) and asks to be paid `amount`. This creates a normal payment
   * request, bound to the card, and the holder gets it on their phone: nothing is debited until they approve it
   * with their PIN. The merchant learns the holder's first name and initial, never a balance.
   */
  async createCharge(
    caller: { userId: string; merchantId: string },
    dto: { qr_token?: string; card_number?: string; amount_cents: number; currency: string; description?: string },
  ) {
    const notUsable = new NotFoundException('Carte introuvable ou non activée.');
    let card: any = null;
    if (dto.qr_token) {
      const token = extractQrToken(dto.qr_token);
      if (!token) throw notUsable;
      ({ data: card } = await this.db.from('cards').select('*').eq('qr_token', token).maybeSingle());
    } else if (dto.card_number) {
      const number = normalizeCardNumber(dto.card_number);
      if (!isValidCardNumber(number)) throw notUsable;
      ({ data: card } = await this.db.from('cards').select('*').eq('card_number', number).maybeSingle());
    } else {
      throw new BadRequestException('Scannez la carte ou saisissez son numéro.');
    }
    // One answer for "no such card", "not activated", "paused", "blocked", "expired": nothing to probe.
    if (!card || card.status !== 'active' || isExpired(card.expires_on)) throw notUsable;
    if (card.user_id === caller.userId) throw new BadRequestException('Vous ne pouvez pas vous encaisser avec votre propre carte.');

    // The same till asking again (new amount, retry): the previous request is replaced, not stacked.
    const { data: previous } = await this.db
      .from('card_charges').select('id, payment_request_id').eq('card_id', card.id).eq('merchant_id', caller.merchantId).eq('status', 'pending');
    for (const p of previous ?? []) await this.cancelCharge(caller.merchantId, p.id).catch(() => undefined);

    const { count } = await this.db
      .from('card_charges').select('id', { count: 'exact', head: true }).eq('card_id', card.id).eq('status', 'pending').gt('expires_at', new Date().toISOString());
    if ((count ?? 0) >= MAX_PENDING_CHARGES_PER_CARD) {
      throw new HttpException('Trop de demandes en attente sur cette carte. Réessayez dans quelques minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const request = await this.paymentRequests.createPaymentRequest(
      caller.merchantId,
      caller.userId,
      {
        amount_cents: dto.amount_cents,
        currency: dto.currency,
        description: dto.description || 'Paiement par carte ScanLinkPay',
        expires_in_minutes: CHARGE_TTL_MINUTES,
      },
      { withQrCode: false },
    );

    const expiresAt = new Date(Date.now() + CHARGE_TTL_MINUTES * 60_000).toISOString();
    const { data: charge, error } = await this.db
      .from('card_charges')
      .insert({
        card_id: card.id,
        merchant_id: caller.merchantId,
        payment_request_id: request.id,
        created_by: caller.userId,
        amount_cents: dto.amount_cents,
        currency: dto.currency,
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (error) {
      await this.db.from('payment_requests').update({ status: 'CANCELLED' }).eq('id', request.id).eq('status', 'CREATED');
      throw new Error(`Failed to create the card charge: ${error.message}`);
    }

    const [{ data: merchant }, { data: profile }] = await Promise.all([
      this.db.from('merchants').select('name').eq('id', caller.merchantId).maybeSingle(),
      this.db.from('profiles').select('full_name').eq('id', card.user_id).maybeSingle(),
    ]);
    await this.notifications.create({
      user_id: card.user_id,
      type: 'card_charge',
      title: 'Paiement par carte à confirmer',
      body: `${merchant?.name ?? 'Un commerçant'} demande ${dto.amount_cents / 100} ${dto.currency}. Ouvrez l'application pour confirmer avec votre PIN.`,
      data: { charge_id: charge.id },
    });
    return {
      charge_id: charge.id,
      status: 'pending',
      amount_cents: dto.amount_cents,
      currency: dto.currency,
      holder: publicHolderName(profile?.full_name),
      expires_at: expiresAt,
    };
  }

  /** Settles what the payment request says, and closes what ran out of time. */
  private async reconcile(charge: any) {
    if (!['pending', 'processing'].includes(charge.status)) return charge;
    const { data: request } = await this.db.from('payment_requests').select('status').eq('id', charge.payment_request_id).maybeSingle();
    const now = Date.now();
    if (request?.status === 'PAID') {
      await this.db.from('card_charges').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', charge.id).in('status', ['pending', 'processing']);
      return { ...charge, status: 'approved' };
    }
    const late = new Date(charge.expires_at).getTime() < now;
    // 'processing' is given a grace period: a payment that started just before the deadline must be allowed to finish.
    const stuck = charge.status === 'processing' && new Date(charge.expires_at).getTime() + 10 * 60_000 < now;
    if ((charge.status === 'pending' && late) || stuck) {
      await this.db.from('card_charges').update({ status: 'expired', decided_at: new Date().toISOString() }).eq('id', charge.id).in('status', ['pending', 'processing']);
      await this.db.from('payment_requests').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', charge.payment_request_id).eq('status', 'CREATED');
      return { ...charge, status: 'expired' };
    }
    return charge;
  }

  async getChargeForMerchant(merchantId: string, chargeId: string) {
    const { data: charge } = await this.db.from('card_charges').select('*').eq('id', chargeId).eq('merchant_id', merchantId).maybeSingle();
    if (!charge) throw new NotFoundException('Demande introuvable.');
    const now = await this.reconcile(charge);
    return { charge_id: now.id, status: now.status, amount_cents: now.amount_cents, currency: now.currency, expires_at: now.expires_at };
  }

  async cancelCharge(merchantId: string, chargeId: string) {
    const { data: charge } = await this.db.from('card_charges').select('*').eq('id', chargeId).eq('merchant_id', merchantId).maybeSingle();
    if (!charge) throw new NotFoundException('Demande introuvable.');
    const { data: cancelled } = await this.db
      .from('card_charges').update({ status: 'cancelled', decided_at: new Date().toISOString() }).eq('id', chargeId).eq('status', 'pending').select('id').maybeSingle();
    if (!cancelled) {
      const now = await this.reconcile(charge);
      throw new ConflictException(now.status === 'approved' ? 'Le client a déjà payé.' : 'Cette demande ne peut plus être annulée.');
    }
    await this.db.from('payment_requests').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', charge.payment_request_id).eq('status', 'CREATED');
    return { status: 'cancelled' };
  }

  /** What is waiting for the holder to confirm. */
  async pendingForHolder(userId: string) {
    const card = await this.liveCard(userId);
    if (!card || card.status !== 'active') return [];
    const { data: charges } = await this.db
      .from('card_charges').select('*').eq('card_id', card.id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
    if (!charges?.length) return [];
    const [{ data: merchants }, { data: requests }] = await Promise.all([
      this.db.from('merchants').select('id, name').in('id', [...new Set(charges.map((c: any) => c.merchant_id))]),
      this.db.from('payment_requests').select('id, description').in('id', charges.map((c: any) => c.payment_request_id)),
    ]);
    const merchantName = new Map((merchants ?? []).map((m: any) => [m.id, m.name]));
    const description = new Map((requests ?? []).map((r: any) => [r.id, r.description]));
    return charges.map((c: any) => ({
      id: c.id,
      merchant_name: merchantName.get(c.merchant_id) ?? 'Commerçant',
      amount_cents: c.amount_cents,
      currency: c.currency,
      description: description.get(c.payment_request_id) ?? null,
      expires_at: c.expires_at,
    }));
  }

  private async chargeOfHolder(userId: string, chargeId: string) {
    const { data: charge } = await this.db.from('card_charges').select('*').eq('id', chargeId).maybeSingle();
    if (!charge) throw new NotFoundException('Demande introuvable.');
    const { data: card } = await this.db.from('cards').select('*').eq('id', charge.card_id).maybeSingle();
    // Somebody else's charge looks like one that doesn't exist.
    if (!card || card.user_id !== userId) throw new NotFoundException('Demande introuvable.');
    return { charge, card };
  }

  /**
   * The holder approves with their PIN. The payment itself is the existing wallet payment (limits, fees, risk,
   * ledger, the merchant's credit): the card only decides WHO may be asked, never how money moves.
   */
  async approve(userId: string, chargeId: string, pin: string) {
    const { charge: found, card } = await this.chargeOfHolder(userId, chargeId);
    const charge = await this.reconcile(found);
    if (charge.status === 'approved') return { status: 'approved' };
    if (charge.status !== 'pending') throw new BadRequestException(charge.status === 'expired' ? 'Cette demande a expiré.' : "Cette demande n'est plus valable.");
    if (card.status !== 'active' || isExpired(card.expires_on)) throw new ForbiddenException("Votre carte n'est pas active : paiement impossible.");

    // Claim it: two approvals at once (double tap, two devices) can never both pay.
    const { data: claimed } = await this.db
      .from('card_charges').update({ status: 'processing' }).eq('id', chargeId).eq('status', 'pending').select('id, payment_request_id').maybeSingle();
    if (!claimed) throw new ConflictException('Cette demande est déjà en cours de traitement.');

    const { data: request } = await this.db.from('payment_requests').select('link_token').eq('id', claimed.payment_request_id).maybeSingle();
    try {
      if (!request) throw new NotFoundException('Facture introuvable');
      // A fresh key for each attempt: a failed attempt must not be replayed as the result of the next one.
      await this.payments.payWithWallet(userId, request.link_token, pin, `card-charge-${chargeId}-${randomUUID()}`);
    } catch (err) {
      // Wrong PIN, not enough money, a limit: the holder can try again while the request lives.
      await this.db.from('card_charges').update({ status: 'pending' }).eq('id', chargeId).eq('status', 'processing');
      throw err;
    }
    await this.db.from('card_charges').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', chargeId);
    await this.audit.log({ user_id: userId, action: 'CARD_CHARGE_APPROVED', entity_type: 'card_charge', entity_id: chargeId, changes: { amount_cents: charge.amount_cents, currency: charge.currency } });
    return { status: 'approved' };
  }

  async decline(userId: string, chargeId: string) {
    const { charge } = await this.chargeOfHolder(userId, chargeId);
    const { data: declined } = await this.db
      .from('card_charges').update({ status: 'declined', decided_at: new Date().toISOString() }).eq('id', chargeId).eq('status', 'pending').select('id').maybeSingle();
    if (!declined) throw new ConflictException('Cette demande ne peut plus être refusée.');
    await this.db.from('payment_requests').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', charge.payment_request_id).eq('status', 'CREATED');
    await this.audit.log({ user_id: userId, action: 'CARD_CHARGE_DECLINED', entity_type: 'card_charge', entity_id: chargeId });
    return { status: 'declined' };
  }
}

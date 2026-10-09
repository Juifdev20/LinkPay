/**
 * The monthly subscription: one price, everything included. The super admin
 * sets the price per month (per currency), the free trial, what happens when
 * the trial or a subscription ends, and the reminder days.
 */

/** What a business may still do once its trial or subscription has ended. */
export type SubscriptionMode = 'read_only' | 'blocked';
export const SUBSCRIPTION_MODES: SubscriptionMode[] = ['read_only', 'blocked'];

export const SUBSCRIPTION_CURRENCIES = ['CDF', 'USD'] as const;
export type SubscriptionCurrency = (typeof SUBSCRIPTION_CURRENCIES)[number];

export const MAX_SUBSCRIPTION_MONTHS = 24;

export interface SubscriptionSettings {
  trial_days: number;
  trial_end_mode: SubscriptionMode;
  expiry_mode: SubscriptionMode;
  reminder_days: number[];
  /**
   * Billing starts here: no business's free trial can start before this date. Set to the day
   * migration 052 is applied, so businesses that existed before the subscription get a full
   * trial instead of being cut off the moment it ships. null = no floor.
   */
  billing_starts_at: string | null;
}

export const DEFAULT_SUBSCRIPTION_SETTINGS: SubscriptionSettings = {
  trial_days: 30,
  trial_end_mode: 'read_only',
  expiry_mode: 'read_only',
  reminder_days: [7, 3, 1],
  billing_starts_at: null,
};

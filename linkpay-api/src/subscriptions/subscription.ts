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
}

export const DEFAULT_SUBSCRIPTION_SETTINGS: SubscriptionSettings = {
  trial_days: 30,
  trial_end_mode: 'read_only',
  expiry_mode: 'read_only',
  reminder_days: [7, 3, 1],
};

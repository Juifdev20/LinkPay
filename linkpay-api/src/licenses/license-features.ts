/**
 * The licensable features. A key names WHAT the code protects (see the
 * @RequireLicense decorators and the web LicenseGate); the super admin renames,
 * enables and prices each one from the admin screen.
 */
export const LICENSE_FEATURE_KEYS = ['pos', 'sales', 'stock', 'inventory', 'stats', 'audit', 'staff'] as const;
export type LicenseFeatureKey = (typeof LICENSE_FEATURE_KEYS)[number];

/** What a business may still do once its trial or a licence has ended. */
export type LicenseMode = 'read_only' | 'blocked';
export const LICENSE_MODES: LicenseMode[] = ['read_only', 'blocked'];

export const LICENSE_CURRENCIES = ['CDF', 'USD'] as const;
export type LicenseCurrency = (typeof LICENSE_CURRENCIES)[number];

export const MAX_LICENSE_DAYS = 3650;

export interface LicenseSettings {
  trial_days: number;
  trial_end_mode: LicenseMode;
  expiry_mode: LicenseMode;
  reminder_days: number[];
}

export const DEFAULT_LICENSE_SETTINGS: LicenseSettings = {
  trial_days: 30,
  trial_end_mode: 'read_only',
  expiry_mode: 'read_only',
  reminder_days: [7, 3, 1],
};

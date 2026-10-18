-- ============================================================================
-- 066_phone_login.sql — Sign up and log in with the phone number; email optional.
--
-- Many people have a phone number but no email. A phone-only account gets a
-- technical email in Supabase Auth (t243XXXXXXXXX@sans-email.scanlinkpay.invalid,
-- a reserved domain nothing is ever sent to) because Auth signs in by email;
-- the profile keeps NO email for it, so the app never shows the technical one.
--
-- Without SMS, a forgotten password is recovered with a recovery code given
-- at sign-up (stored hashed here) — or by email, when the person gave one.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

-- The email becomes optional (still unique when present).
ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;

-- The auto-created profile never copies the technical email.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone)
  VALUES (
    NEW.id,
    CASE WHEN NEW.email LIKE '%@sans-email.scanlinkpay.invalid' THEN NULL ELSE NEW.email END,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recovery code (bcrypt hash, never the code itself).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recovery_code_set_at TIMESTAMPTZ;

-- Logging in looks the account up by its phone number.
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);

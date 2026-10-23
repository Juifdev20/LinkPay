-- ============================================================================
-- 068_security_hold.sql — No money leaves an account for 24 h after its keys changed.
--
-- With automatic withdrawals, nobody looks at a withdrawal before the money leaves. The usual way to empty
-- somebody's account is to take it over and change its keys (password, PIN, phone number used to log in, email
-- used to reset the password) before sending the money out. So the API refuses every way money can leave an
-- account — withdrawal, transfer, wallet payment to a merchant, merchant refund — for 24 hours after one of
-- those changes (src/common/security-hold.ts). The owner, warned by the change, has time to react.
--
-- profiles.security_changed_at is stamped HERE, by triggers, so that every path counts — including the password
-- reset by email link, which never goes through the API.
--
-- Run once in the Supabase SQL editor (after 067), BEFORE deploying the API version that reads it.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS security_changed_at TIMESTAMPTZ;

-- PIN (set or changed — a first PIN too: on an account that had none, it is exactly what someone who took the
-- account over would do before sending money out), phone number or email changed (filling in a missing one at
-- sign-up is not a change).
CREATE OR REPLACE FUNCTION public.stamp_profile_security_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.transaction_pin_hash IS DISTINCT FROM OLD.transaction_pin_hash
     OR (OLD.phone IS NOT NULL AND NEW.phone IS DISTINCT FROM OLD.phone)
     OR (OLD.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email) THEN
    NEW.security_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_security_change ON profiles;
CREATE TRIGGER trg_profiles_security_change
  BEFORE UPDATE OF transaction_pin_hash, phone, email ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_profile_security_change();

-- Password, login email or phone changed in Supabase Auth (by the API or by the email reset link).
CREATE OR REPLACE FUNCTION public.stamp_auth_security_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.encrypted_password IS NOT NULL AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password)
     OR (OLD.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email)
     OR (OLD.phone IS NOT NULL AND NEW.phone IS DISTINCT FROM OLD.phone) THEN
    UPDATE public.profiles SET security_changed_at = NOW() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auth_security_change ON auth.users;
CREATE TRIGGER trg_auth_security_change
  AFTER UPDATE OF encrypted_password, email, phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.stamp_auth_security_change();

REVOKE ALL ON FUNCTION public.stamp_profile_security_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_auth_security_change() FROM PUBLIC;

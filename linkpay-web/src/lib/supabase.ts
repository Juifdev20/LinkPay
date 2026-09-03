import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Used only for Realtime subscriptions — all data reads/writes still go
// through the NestJS API (lib/api.ts). RLS policies (see
// linkpay-api/supabase/migrations/003_fix_rls_policies.sql) are what keep
// this client's access scoped to the signed-in user once a session is set
// via supabase.auth.setSession() (done in auth-store.ts on login/register).
export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    })
  : null;

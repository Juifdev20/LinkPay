// One-off local admin tool: reset any account's password + free its
// single-session slot, without needing the old password.
// Usage (from linkpay-api/):
//   node reset-user-password.js <email> <nouveauMotDePasse>
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env — never prints them.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const [,, email, newPassword] = process.argv;
if (!email || !newPassword) {
  console.error('Usage: node reset-user-password.js <email> <nouveauMotDePasse>');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Le mot de passe doit faire au moins 8 caractères.');
  process.exit(1);
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .single();
  if (error || !profile) {
    console.error(`Utilisateur introuvable: ${email}`);
    process.exit(1);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(profile.id, {
    password: newPassword,
  });
  if (authError) {
    console.error(`Échec Supabase Auth: ${authError.message}`);
    process.exit(1);
  }

  // Free the session slot too so the account can log in from a new device.
  await admin
    .from('profiles')
    .update({ active_session_id: null, active_device_id: null, must_change_password: false })
    .eq('id', profile.id);

  console.log(`OK — mot de passe réinitialisé et session libérée pour ${email}`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

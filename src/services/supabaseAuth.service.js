// src/services/supabaseAuth.service.js
//
// Thin wrapper around Supabase Auth for password-reset flows.
// Uses the service-role key so the backend can call admin APIs when needed,
// but resetPasswordForEmail only requires the anon key.

const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    const err = new Error(
      'SUPABASE_URL e SUPABASE_SECRET_KEY (ou SUPABASE_ANON_KEY) devem estar configurados.'
    );
    err.status = 500;
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Triggers Supabase to send a password-reset email to the given address.
 * Supabase handles the email delivery — no SMTP required on our side.
 *
 * @param {string} email
 * @param {string} redirectTo  Full URL the reset link should redirect to (frontend page).
 * @returns {Promise<void>}    Throws on configuration or API error.
 */
async function sendPasswordResetEmail(email, redirectTo) {
  const supabase = getSupabaseClient();

  console.log(`[SUPABASE_AUTH] Solicitando reset de senha para: ${email}`);

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    console.error('[SUPABASE_AUTH] Erro ao solicitar reset de senha:', error.message);
    const err = new Error(error.message || 'Falha ao solicitar redefinição de senha via Supabase.');
    err.status = 502;
    err.code = 'SUPABASE_RESET_ERROR';
    throw err;
  }

  console.log(`[SUPABASE_AUTH] E-mail de reset enviado com sucesso para: ${email}`);
}

/**
 * Updates the authenticated user's password using the access token extracted
 * from the reset link that Supabase sent to the user's inbox.
 *
 * The frontend must extract the access_token from the URL hash/query after the
 * user clicks the reset link, then pass it here alongside the new password.
 *
 * @param {string} accessToken  Token from the Supabase reset link.
 * @param {string} newPassword  New password chosen by the user (min 6 chars).
 * @returns {Promise<void>}     Throws on invalid token or API error.
 */
async function updatePasswordWithToken(accessToken, newPassword) {
  if (!accessToken || typeof accessToken !== 'string') {
    const err = new Error('Token de acesso é obrigatório.');
    err.status = 400;
    throw err;
  }
  if (!newPassword || String(newPassword).length < 6) {
    const err = new Error('A nova senha deve ter no mínimo 6 caracteres.');
    err.status = 400;
    throw err;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    const err = new Error(
      'SUPABASE_URL e SUPABASE_SECRET_KEY (ou SUPABASE_ANON_KEY) devem estar configurados.'
    );
    err.status = 500;
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  // Create a client pre-seeded with the user's session token so updateUser
  // acts on behalf of that user.
  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });

  console.log('[SUPABASE_AUTH] Atualizando senha do usuário via token de reset...');

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    console.error('[SUPABASE_AUTH] Erro ao atualizar senha:', error.message);
    const err = new Error(
      error.message || 'Token inválido ou expirado. Solicite uma nova recuperação de senha.'
    );
    err.status = 400;
    err.code = 'SUPABASE_UPDATE_ERROR';
    throw err;
  }

  console.log('[SUPABASE_AUTH] Senha atualizada com sucesso via Supabase Auth.');
}

module.exports = { sendPasswordResetEmail, updatePasswordWithToken };

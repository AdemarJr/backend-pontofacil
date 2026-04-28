// src/services/supabaseAuth.service.js
//
// Thin wrapper around Supabase Auth for password-reset flows.
// Uses the service-role key so the backend can call admin APIs when needed,
// but resetPasswordForEmail only requires the anon key.
//
// ─── Customising the password-reset email ────────────────────────────────────
//
// Supabase sends the actual email using the template configured in the
// Supabase dashboard (Authentication → Email Templates → Reset Password).
// The `buildPasswordResetEmail()` function below lets you define the subject
// and body that SHOULD appear in that email, so you can keep both in sync
// without touching the Supabase dashboard every time.
//
// Two ways to customise:
//
//   1. Via environment variables (recommended for production):
//        PASSWORD_RESET_EMAIL_SUBJECT  — overrides the email subject line
//        PASSWORD_RESET_EMAIL_BODY     — overrides the full plain-text body
//                                        (use the literal string "{{redirectTo}}"
//                                         anywhere in the body; it will be
//                                         replaced with the actual reset URL)
//
//   2. Via direct code modification (handy during development):
//        Edit the `defaultSubject` and `defaultBody` template literals inside
//        `buildPasswordResetEmail()` below.  No env vars needed.
//
// ─────────────────────────────────────────────────────────────────────────────

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
 * Builds the subject and body for the password-reset email.
 *
 * This function is the single place to customise the email content without
 * touching the Supabase dashboard.  The returned values mirror what you should
 * paste into Authentication → Email Templates → Reset Password in Supabase so
 * that the delivered email matches what the code expects.
 *
 * Customisation options (in order of precedence):
 *   1. Set PASSWORD_RESET_EMAIL_SUBJECT / PASSWORD_RESET_EMAIL_BODY env vars.
 *   2. Edit the `defaultSubject` / `defaultBody` literals directly below.
 *
 * The placeholder `{{redirectTo}}` inside PASSWORD_RESET_EMAIL_BODY (env var)
 * is replaced at runtime with the actual reset URL passed to this function.
 *
 * @param {string} email       Recipient address (informational — not used in
 *                             the body by default, but available for custom
 *                             templates that want to include it).
 * @param {string} redirectTo  Full reset URL, e.g.
 *                             https://pontofacil.digital/redefinir-senha
 * @returns {{ subject: string, body: string }}
 */
function buildPasswordResetEmail(email, redirectTo) {
  // ── Subject ──────────────────────────────────────────────────────────────
  const defaultSubject = 'PontoFácil — Recuperação de Senha';
  const subject = process.env.PASSWORD_RESET_EMAIL_SUBJECT || defaultSubject;

  // ── Body ─────────────────────────────────────────────────────────────────
  // Edit the template literal below to change the default message.
  // Keep ${redirectTo} so the reset link is always included.
  const defaultBody = `Olá,

Recebemos uma solicitação para redefinir sua senha no PontoFácil.

Clique no link abaixo para criar uma nova senha:
${redirectTo}

Este link expira em 1 hora.

Se você não solicitou isso, ignore este e-mail — sua senha permanece a mesma.

Atenciosamente,
Equipe PontoFácil
https://pontofacil.digital`;

  // When the body comes from an env var the literal string "{{redirectTo}}"
  // is substituted with the real URL so operators don't need to hard-code it.
  const rawBody = process.env.PASSWORD_RESET_EMAIL_BODY || defaultBody;
  const body = rawBody.replace(/\{\{redirectTo\}\}/g, redirectTo);

  return { subject, body };
}

/**
 * Triggers Supabase to send a password-reset email to the given address.
 * Supabase handles the email delivery — no SMTP required on our side.
 *
 * The email content (subject / body) is defined by `buildPasswordResetEmail()`
 * above.  To change what the email says, edit that function or set the
 * PASSWORD_RESET_EMAIL_SUBJECT / PASSWORD_RESET_EMAIL_BODY environment
 * variables.  The Supabase dashboard template should be kept in sync with
 * whatever `buildPasswordResetEmail()` returns.
 *
 * @param {string} email
 * @param {string} redirectTo  Full URL the reset link should redirect to (frontend page).
 * @returns {Promise<void>}    Throws on configuration or API error.
 */
async function sendPasswordResetEmail(email, redirectTo) {
  const supabase = getSupabaseClient();

  // Build and log the email template so operators can confirm the content
  // without having to open the Supabase dashboard.
  const { subject, body } = buildPasswordResetEmail(email, redirectTo);
  console.log(`[SUPABASE_AUTH] Solicitando reset de senha para: ${email}`);
  console.log(`[SUPABASE_AUTH] Assunto do e-mail: ${subject}`);
  console.log(`[SUPABASE_AUTH] Corpo do e-mail (template):\n${body}`);

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

module.exports = { buildPasswordResetEmail, sendPasswordResetEmail, updatePasswordWithToken };

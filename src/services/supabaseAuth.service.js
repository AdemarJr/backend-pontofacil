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

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    const err = new Error('SUPABASE_URL e SUPABASE_SECRET_KEY devem estar configurados para operações admin.');
    err.status = 500;
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Ensures a Supabase Auth user exists for the given email.
 * This is required because `resetPasswordForEmail` only sends an email if the user exists.
 */
async function ensureSupabaseUserExists(email, userMetadata = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) {
    const err = new Error('E-mail é obrigatório.');
    err.status = 400;
    throw err;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: e,
    email_confirm: true,
    user_metadata: userMetadata && typeof userMetadata === 'object' ? userMetadata : {},
  });

  if (error) {
    const msg = String(error.message || '');
    // Supabase returns variations like "User already registered" depending on version.
    if (/already\s+registered|already\s+exists|User\s+already/i.test(msg)) {
      return { created: false };
    }
    const err = new Error(msg || 'Falha ao criar usuário no Supabase Auth.');
    err.status = 502;
    err.code = 'SUPABASE_ADMIN_CREATE_ERROR';
    throw err;
  }

  return { created: true, userId: data?.user?.id || null };
}

/**
 * Sends an invitation / first access email via Supabase Auth (Invite user).
 * This is the recommended flow for creating a new company + manager/admin and
 * having the recipient set their password securely.
 *
 * @param {string} email
 * @param {string} redirectTo
 * @param {object} userMetadata
 */
async function sendFirstAccessInviteEmail(email, redirectTo, userMetadata = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) {
    const err = new Error('E-mail é obrigatório.');
    err.status = 400;
    throw err;
  }
  const r = String(redirectTo || '').trim();
  if (!r) {
    const err = new Error('redirectTo é obrigatório.');
    err.status = 400;
    throw err;
  }

  const supabase = getSupabaseAdminClient();
  console.log(`[SUPABASE_AUTH] Enviando convite (primeiro acesso) para: ${e}`);
  console.log(`[SUPABASE_AUTH] redirectTo (invite): ${r}`);
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(e, {
    redirectTo: r,
    data: userMetadata && typeof userMetadata === 'object' ? userMetadata : {},
  });

  if (error) {
    const err = new Error(error.message || 'Falha ao enviar convite (primeiro acesso) via Supabase.');
    err.status = 502;
    err.code = 'SUPABASE_INVITE_ERROR';
    throw err;
  }

  return { ok: true, userId: data?.user?.id || null };
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
  console.log(`[SUPABASE_AUTH] redirectTo (recovery): ${redirectTo}`);

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
 * @returns {Promise<{email: string | null}>}  Throws on invalid token or API error.
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

  // We fetch the user first so the controller can sync the local DB (Prisma) by email.
  let email = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) email = data?.user?.email || null;
  } catch {
    // ignore (best-effort)
  }

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
  return { email };
}

/**
 * Sends a welcome/invitation email to a newly created manager or account owner.
 * Reuses Supabase's resetPasswordForEmail flow so the recipient receives a secure
 * link to set their own password on first access — no SMTP required on our side.
 *
 * @param {string} email        Manager's email address.
 * @param {string} nome         Manager's full name.
 * @param {string} nomeEmpresa  Company name the manager was added to.
 * @returns {Promise<void>}     Throws on configuration or API error.
 */
async function sendNewManagerInviteEmail(email, nome, nomeEmpresa) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    const err = new Error('E-mail do gerente é obrigatório.');
    err.status = 400;
    throw err;
  }
  if (!nome || typeof nome !== 'string' || !nome.trim()) {
    const err = new Error('Nome do gerente é obrigatório.');
    err.status = 400;
    throw err;
  }

  const supabase = getSupabaseClient();

  const frontendBase = String(process.env.FRONTEND_URL || 'https://pontofacil.digital').replace(/\/$/, '');
  const redirectTo = `${frontendBase}/redefinir-senha`;
  const loginUrl = `${frontendBase}/login`;
  const empresa = String(nomeEmpresa || 'sua empresa').trim();

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const nomeEsc = escHtml(nome.trim());
  const empresaEsc = escHtml(empresa);
  const emailEsc = escHtml(email.trim().toLowerCase());

  // Build a professional HTML email in Portuguese
  const emailHtml = `
    <div style="background:#f6f7f9;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8eaee;border-radius:12px;overflow:hidden;">

        <!-- Header -->
        <div style="padding:18px 20px;background:linear-gradient(135deg,#1D9E75 0%,#085041 100%);color:#fff;">
          <div style="font-weight:800;letter-spacing:0.2px;font-size:18px;">PontoFácil</div>
          <div style="opacity:0.95;font-size:13px;margin-top:2px;">Convite de acesso — ${empresaEsc}</div>
        </div>

        <!-- Body -->
        <div style="padding:24px 20px;color:#111827;">
          <p style="margin:0 0 12px 0;font-size:15px;">
            Olá, <strong>${nomeEsc}</strong>!
          </p>
          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#374151;">
            Você foi adicionado(a) como <strong>gerente</strong> da empresa
            <strong>${empresaEsc}</strong> no <strong>PontoFácil</strong>.
          </p>
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#374151;">
            Para ativar seu acesso, clique no botão abaixo e crie sua senha. O link é válido por
            <strong>24 horas</strong> — após esse prazo, solicite um novo convite ao administrador.
          </p>

          <!-- CTA Button -->
          <p style="margin:20px 0;">
            <a href="${redirectTo}"
               style="display:inline-block;padding:13px 22px;background:#1D9E75;color:#ffffff;
                      text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;
                      letter-spacing:0.2px;">
              Definir minha senha
            </a>
          </p>

          <!-- Divider -->
          <div style="border-top:1px solid #eef0f3;margin:20px 0;"></div>

          <!-- Access details -->
          <div style="font-size:13.5px;line-height:1.7;color:#111827;">
            <div style="font-weight:800;margin-bottom:6px;">Seus dados de acesso</div>
            <div><strong>Perfil:</strong> Gerente</div>
            <div><strong>Empresa:</strong> ${empresaEsc}</div>
            <div><strong>E-mail (login):</strong> ${emailEsc}</div>
          </div>

          <!-- Divider -->
          <div style="border-top:1px solid #eef0f3;margin:20px 0;"></div>

          <!-- Useful links -->
          <div style="font-size:13.5px;line-height:1.7;">
            <div style="font-weight:800;margin-bottom:6px;">Links úteis</div>
            <div>
              <strong>Login:</strong>
              <a href="${loginUrl}" style="color:#1D9E75;">${escHtml(loginUrl)}</a>
            </div>
          </div>

          <!-- Fallback link -->
          <div style="margin-top:18px;padding:12px;background:#f9fafb;border:1px solid #eef0f3;border-radius:10px;">
            <div style="font-size:12.5px;color:#6b7280;line-height:1.55;">
              Se o botão não abrir, copie e cole este link no navegador:<br/>
              <span style="word-break:break-all;color:#374151;">${escHtml(redirectTo)}</span>
            </div>
          </div>

          <p style="margin:16px 0 0 0;font-size:12.5px;color:#6b7280;line-height:1.55;">
            Se você não esperava este convite, pode ignorar este e-mail com segurança.
            Nenhuma ação será tomada sem que você clique no link acima.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="max-width:560px;margin:10px auto 0 auto;font-size:11.5px;color:#9ca3af;line-height:1.4;text-align:center;">
        Enviado automaticamente por PontoFácil · <a href="https://pontofacil.digital" style="color:#9ca3af;">pontofacil.digital</a>
      </div>
    </div>
  `;

  console.log(`[SUPABASE_AUTH] Enviando convite de gerente para: ${email} (empresa: ${empresa})`);

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  });

  if (error) {
    console.error('[SUPABASE_AUTH] Erro ao enviar convite de gerente:', error.message);
    const err = new Error(error.message || 'Falha ao enviar convite via Supabase.');
    err.status = 502;
    err.code = 'SUPABASE_INVITE_ERROR';
    throw err;
  }

  console.log(`[SUPABASE_AUTH] Convite de gerente enviado com sucesso para: ${email}`);
}

module.exports = {
  sendPasswordResetEmail,
  updatePasswordWithToken,
  sendNewManagerInviteEmail,
  ensureSupabaseUserExists,
  sendFirstAccessInviteEmail,
};

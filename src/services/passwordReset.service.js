const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { sendMail, isMailConfigured } = require('./mail.service');
const { decryptPin } = require('../utils/pinCrypto');

const prisma = new PrismaClient();

function frontendBase() {
  const raw = String(process.env.FRONTEND_URL || '').trim();
  const fallback = 'https://pontofacil.digital';

  // Em produção, precisamos do FRONTEND_URL correto para o redirect_to do Supabase
  // e para qualquer link que saia do backend. Evita enviar e-mails com localhost.
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error('FRONTEND_URL é obrigatório em produção (ex.: https://app.seudominio.com)');
      err.status = 500;
      throw err;
    }
    return fallback;
  }
  return raw.replace(/\/$/, '');
}

function resetExpiresHours() {
  return parseInt(process.env.PASSWORD_RESET_EXPIRES_HOURS || '48', 10);
}

function buildResetLink(token) {
  return `${frontendBase()}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

function meuPontoLink() {
  return `${frontendBase()}/meu-ponto`;
}

function shouldSendPinInEmail() {
  return process.env.SEND_PIN_IN_EMAIL === '1' || process.env.SEND_PIN_IN_EMAIL === 'true';
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function issueUsuarioToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const passwordResetExpires = new Date(Date.now() + resetExpiresHours() * 3600000);
  await prisma.usuario.update({
    where: { id: userId },
    data: { passwordResetToken: token, passwordResetExpires },
  });
  return token;
}

async function issueSuperAdminToken(id) {
  const token = crypto.randomBytes(32).toString('hex');
  const passwordResetExpires = new Date(Date.now() + resetExpiresHours() * 3600000);
  await prisma.superAdmin.update({
    where: { id },
    data: { passwordResetToken: token, passwordResetExpires },
  });
  return token;
}

/**
 * Convite / primeiro acesso — define senha web (PIN do totem permanece o cadastrado).
 */
async function sendConviteUsuario(userId) {
  const u = await prisma.usuario.findUnique({
    where: { id: userId },
    include: { tenant: { select: { nomeFantasia: true } } },
  });
  if (!u) return { ok: false, skipped: true, reason: 'not_found' };

  const token = await issueUsuarioToken(u.id);
  const link = buildResetLink(token);
  const empresa = u.tenant?.nomeFantasia || 'sua empresa';
  const linkMeuPonto = meuPontoLink();
  const emailLogin = u.email;
  const pin =
    shouldSendPinInEmail() && u.pinEncrypted
      ? (() => {
          try {
            return decryptPin(u.pinEncrypted);
          } catch (e) {
            console.warn('[mail] Falha ao descriptografar PIN para e-mail:', e.message);
            return null;
          }
        })()
      : null;

  const isColaborador = u.role === 'COLABORADOR';
  const tituloAcesso = isColaborador ? 'Meu Ponto (colaborador)' : 'Painel (admin/gerente)';
  const subject = `PontoFácil — seu acesso (${empresa})`;
  const loginUrl = `${frontendBase()}/login`;
  const expiresTxt = `${resetExpiresHours()} horas`;
  const pinText = pin
    ? [`PIN do totem: ${pin}`]
    : [
        'PIN do totem: informado pelo administrador.',
        '(Por segurança, este servidor está configurado para não enviar PIN por e-mail.)',
      ];

  const text = [
    `Olá, ${u.nome}!`,
    '',
    `Bem-vindo(a) ao PontoFácil (${empresa}).`,
    'Para concluir seu cadastro, defina sua senha de acesso pelo link abaixo:',
    '',
    link,
    '',
    `Este link expira em cerca de ${expiresTxt}.`,
    '',
    'Seus dados de acesso:',
    `- Perfil: ${tituloAcesso}`,
    `- E-mail (login): ${emailLogin}`,
    ...pinText.map((x) => `- ${x}`),
    '',
    'Links úteis:',
    `- Login: ${loginUrl}`,
    `- Meu Ponto: ${linkMeuPonto}`,
    '',
    'Se você não solicitou esse acesso, pode ignorar este e-mail.',
  ].join('\n');

  const html = `
    <div style="background:#f6f7f9;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8eaee;border-radius:12px;overflow:hidden;">
        <div style="padding:18px 20px;background:linear-gradient(135deg,#1D9E75 0%,#085041 100%);color:#fff;">
          <div style="font-weight:800;letter-spacing:0.2px;font-size:18px;">PontoFácil</div>
          <div style="opacity:0.95;font-size:13px;margin-top:2px;">Acesso — ${escHtml(empresa)}</div>
        </div>
        <div style="padding:22px 20px;color:#111827;">
          <p style="margin:0 0 10px 0;font-size:15px;">Olá, <strong>${escHtml(u.nome)}</strong>!</p>
          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#374151;">
            Você foi cadastrado(a) no <strong>PontoFácil</strong>. Para concluir o primeiro acesso, crie sua senha clicando no botão abaixo.
          </p>
          <p style="margin:16px 0;">
            <a href="${link}" style="display:inline-block;padding:12px 16px;background:#1D9E75;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">
              Definir minha senha
            </a>
          </p>
          <p style="margin:0 0 14px 0;font-size:12.5px;line-height:1.55;color:#6b7280;">
            Este link expira em cerca de <strong>${escHtml(expiresTxt)}</strong>.
          </p>
          <div style="border-top:1px solid #eef0f3;margin:18px 0;"></div>
          <div style="font-size:13.5px;line-height:1.6;color:#111827;">
            <div style="font-weight:800;margin-bottom:6px;">Seus dados de acesso</div>
            <div><strong>Perfil:</strong> ${escHtml(tituloAcesso)}</div>
            <div><strong>E-mail (login):</strong> ${escHtml(emailLogin)}</div>
            ${
              pin
                ? `<div><strong>PIN do totem:</strong> ${escHtml(pin)}</div>`
                : `<div style="color:#6b7280;"><strong>PIN do totem:</strong> informado pelo administrador (não enviamos por e-mail).</div>`
            }
          </div>
          <div style="border-top:1px solid #eef0f3;margin:18px 0;"></div>
          <div style="font-size:13.5px;line-height:1.7;">
            <div style="font-weight:800;margin-bottom:6px;">Links úteis</div>
            <div><strong>Login:</strong> <a href="${loginUrl}">${escHtml(loginUrl)}</a></div>
            <div><strong>Meu Ponto:</strong> <a href="${linkMeuPonto}">${escHtml(linkMeuPonto)}</a></div>
          </div>
          <div style="margin-top:18px;padding:12px 12px;background:#f9fafb;border:1px solid #eef0f3;border-radius:10px;">
            <div style="font-size:12.5px;color:#6b7280;line-height:1.55;">
              Se o botão não abrir, copie e cole este link no navegador:<br/>
              <span style="word-break:break-all;color:#374151;">${escHtml(link)}</span>
            </div>
          </div>
          <p style="margin:16px 0 0 0;font-size:12.5px;color:#6b7280;line-height:1.55;">
            Se você não reconhece este acesso, ignore este e-mail.
          </p>
        </div>
      </div>
      <div style="max-width:560px;margin:10px auto 0 auto;font-size:11.5px;color:#9ca3af;line-height:1.4;text-align:center;">
        Enviado automaticamente por PontoFácil.
      </div>
    </div>
  `;

  const r = await sendMail({ to: u.email, subject, text, html });
  if (r.ok) return { ok: true, skipped: false };
  if (r.skipped) return { ok: false, skipped: true, reason: r.reason || 'smtp_nao_configurado' };
  return { ok: false, skipped: false, reason: r.reason || 'falha_envio', error: r.error };
}

async function sendResetUsuarioEmail(usuario) {
  const token = await issueUsuarioToken(usuario.id);
  const link = buildResetLink(token);
  const empresa = usuario.tenant?.nomeFantasia || 'sua empresa';
  const subject = `PontoFácil — recuperação de senha (${empresa})`;
  const text = [
    `Olá, ${usuario.nome}.`,
    '',
    'Recebemos um pedido para redefinir sua senha de acesso ao PontoFácil.',
    '',
    link,
    '',
    `O link expira em cerca de ${resetExpiresHours()} horas.`,
    'Se você não pediu, ignore este e-mail.',
  ].join('\n');
  const html = `
    <p>Olá, <strong>${escHtml(usuario.nome)}</strong>.</p>
    <p>Recebemos um pedido para redefinir sua senha no PontoFácil (${escHtml(empresa)}).</p>
    <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1D9E75;color:#fff;text-decoration:none;border-radius:8px;">Redefinir senha</a></p>
    <p style="font-size:13px;color:#666;">${escHtml(link)}</p>
  `;
  return sendMail({ to: usuario.email, subject, text, html });
}

async function sendResetSuperAdminEmail(sa) {
  const token = await issueSuperAdminToken(sa.id);
  const link = buildResetLink(token);
  const subject = 'PontoFácil — recuperação de senha (Super Admin)';
  const text = [
    `Olá, ${sa.nome}.`,
    '',
    'Pedido de redefinição de senha da conta Super Admin.',
    '',
    link,
    '',
    `Expira em cerca de ${resetExpiresHours()} horas.`,
  ].join('\n');
  const html = `
    <p>Olá, <strong>${escHtml(sa.nome)}</strong>.</p>
    <p>Pedido de redefinição de senha (Super Admin).</p>
    <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1D9E75;color:#fff;text-decoration:none;border-radius:8px;">Redefinir senha</a></p>
  `;
  return sendMail({ to: sa.email, subject, text, html });
}

function assertMailOk(r) {
  if (r?.ok) return;
  const err = new Error(
    r?.skipped
      ? 'Servidor sem SMTP configurado para envio de e-mails. Contate o administrador.'
      : `Falha ao enviar e-mail. Verifique SMTP (host/porta/secure/usuário/senha) e logs do servidor.`
  );
  err.status = r?.skipped ? 503 : 502;
  err.code = r?.skipped ? 'SMTP_NAO_CONFIGURADO' : 'SMTP_FALHA_ENVIO';
  throw err;
}

/**
 * Esqueci minha senha — e-mail pode existir em mais de um tenant.
 */
async function requestForgotByEmail(emailRaw, tenantIdOpt) {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('E-mail é obrigatório');
    err.status = 400;
    throw err;
  }

  const sa = await prisma.superAdmin.findUnique({ where: { email } });
  if (sa && sa.ativo) {
    const r = await sendResetSuperAdminEmail(sa);
    assertMailOk(r);
    return { destino: 'super_admin' };
  }

  const usuarios = await prisma.usuario.findMany({
    where: { email, ativo: true },
    include: { tenant: { select: { nomeFantasia: true, status: true } } },
  });

  const ativos = usuarios.filter((u) => u.tenant?.status === 'ATIVO');
  if (ativos.length === 0) {
    return { destino: 'nenhum' };
  }

  if (ativos.length > 1) {
    if (!tenantIdOpt) {
      const err = new Error(
        'Este e-mail está cadastrado em mais de uma empresa. Informe o ID da empresa (em Configurações → ID do Totem) no campo indicado.'
      );
      err.status = 400;
      err.code = 'TENANT_ID_OBRIGATORIO';
      throw err;
    }
    const u = ativos.find((x) => x.tenantId === tenantIdOpt);
    if (!u) {
      const err = new Error('Nenhum usuário encontrado com este e-mail nesta empresa.');
      err.status = 404;
      throw err;
    }
    const r = await sendResetUsuarioEmail(u);
    assertMailOk(r);
    return { destino: 'usuario' };
  }

  const r = await sendResetUsuarioEmail(ativos[0]);
  assertMailOk(r);
  return { destino: 'usuario' };
}

async function resetPasswordWithToken(token, novaSenha) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Token é obrigatório');
    err.status = 400;
    throw err;
  }
  if (!novaSenha || String(novaSenha).length < 6) {
    const err = new Error('Senha deve ter no mínimo 6 caracteres');
    err.status = 400;
    throw err;
  }

  const u = await prisma.usuario.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpires: { gt: new Date() },
    },
  });
  if (u) {
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    await prisma.usuario.update({
      where: { id: u.id },
      data: {
        senhaHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
    return { ok: true, tipo: 'usuario' };
  }

  const sa = await prisma.superAdmin.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpires: { gt: new Date() },
    },
  });
  if (sa) {
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    await prisma.superAdmin.update({
      where: { id: sa.id },
      data: {
        senhaHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
    return { ok: true, tipo: 'super_admin' };
  }

  const err = new Error('Link inválido ou expirado. Solicite uma nova recuperação de senha.');
  err.status = 400;
  throw err;
}

module.exports = {
  isMailConfigured,
  buildResetLink,
  sendConviteUsuario,
  requestForgotByEmail,
  resetPasswordWithToken,
  issueUsuarioToken,
  frontendBase,
};

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { sendMail, isMailConfigured } = require('./mail.service');

const prisma = new PrismaClient();

function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://pontofacil.digital').replace(/\/$/, '');
}

function resetExpiresHours() {
  return parseInt(process.env.PASSWORD_RESET_EXPIRES_HOURS || '48', 10);
}

function buildResetLink(token) {
  return `${frontendBase()}/redefinir-senha?token=${encodeURIComponent(token)}`;
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
  const subject = `PontoFácil — defina sua senha de acesso (${empresa})`;
  const text = [
    `Olá, ${u.nome}.`,
    '',
    `Você foi cadastrado no PontoFácil (${empresa}).`,
    'Defina uma senha para acessar o sistema pelo navegador (login em ' + frontendBase() + '/login — painel ou Meu ponto).',
    'Seu PIN do totem é o informado pelo administrador (não enviamos o PIN por e-mail).',
    '',
    link,
    '',
    `Este link expira em aproximadamente ${resetExpiresHours()} horas.`,
    '',
    'Se você não reconhece este cadastro, ignore este e-mail.',
  ].join('\n');

  const html = `
    <p>Olá, <strong>${escHtml(u.nome)}</strong>.</p>
    <p>Você foi cadastrado no <strong>PontoFácil</strong> (${escHtml(empresa)}).</p>
    <p>Clique no botão abaixo para <strong>definir sua senha de acesso</strong> pelo navegador (painel ou Meu ponto).</p>
    <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1D9E75;color:#fff;text-decoration:none;border-radius:8px;">Definir minha senha</a></p>
    <p style="font-size:13px;color:#666;">Ou copie o link: <br/><span style="word-break:break-all">${escHtml(link)}</span></p>
    <p style="font-size:13px;color:#666;">Seu PIN do totem continua o que o RH informou. Link expira em cerca de ${resetExpiresHours()} horas.</p>
  `;

  const r = await sendMail({ to: u.email, subject, text, html });
  return { ok: r.ok, skipped: r.skipped };
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
    await sendResetSuperAdminEmail(sa);
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
    await sendResetUsuarioEmail(u);
    return { destino: 'usuario' };
  }

  await sendResetUsuarioEmail(ativos[0]);
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

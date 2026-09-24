/**
 * Dicas operacionais para falhas SMTP/Brevo (logs e Super Admin).
 * Não use no retorno da API para clientes do tenant.
 */
function dicaParaErroSmtp(errorMsg) {
  const m = String(errorMsg || '').toLowerCase();
  if (
    m.includes('unrecognised ip') ||
    m.includes('unrecognized ip') ||
    m.includes('authorised_ips') ||
    m.includes('authorized_ips') ||
    m.includes('ip not authorized')
  ) {
    return (
      'Brevo bloqueou o IP de saída. Settings → Security → Authorized IPs: ' +
      'adicione o IP do Railway ou desative "Block unknown IP addresses" (Hobby muda o IP).'
    );
  }
  if (m.includes('535') || m.includes('invalid login') || m.includes('authentication')) {
    return (
      'Autenticação recusada: confira SMTP_USER (e-mail completo) e SMTP_PASS no Railway. ' +
      'Senhas com $, + ou > devem ser coladas exatamente (sem aspas extras). ' +
      'No painel Hostinger, confirme que a caixa de e-mail existe e a senha está correta.'
    );
  }
  if (m.includes('etimedout') || m.includes('timeout') || m.includes('econnrefused')) {
    return (
      'Não conectou ao servidor SMTP. Teste SMTP_PORT=587 e SMTP_SECURE=false, ' +
      'ou verifique se o provedor de hospedagem (Railway) permite saída SMTP nas portas 465/587.'
    );
  }
  if (m.includes('certificate') || m.includes('tls') || m.includes('ssl')) {
    return 'Falha TLS/SSL: para teste, use SMTP_PORT=587, SMTP_SECURE=false. Evite SMTP_TLS_REJECT_UNAUTHORIZED=0 em produção.';
  }
  if (m.includes('getaddrinfo') || m.includes('enotfound')) {
    return 'Host SMTP inválido ou DNS indisponível. Verifique SMTP_HOST (ex.: smtp.hostinger.com).';
  }
  if (m.includes('brevo') || m.includes('api key')) {
    return 'Confira BREVO_API_KEY (xkeysib-...) e remetente verificado no Brevo.';
  }
  return 'Veja os logs do backend ([mail] Falha ao enviar) e confira host, porta, secure, usuário e senha.';
}

/** Mensagem curta para o cliente do tenant (RH, recuperação de senha, etc.). */
function formatMailError(r) {
  if (r?.ok) return null;
  if (r?.skipped) {
    return 'Envio de e-mail indisponível no momento. Contate o administrador.';
  }
  return 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.';
}

/** Mensagem detalhada para Super Admin / diagnóstico. */
function formatMailErrorOps(r) {
  if (r?.ok) return null;
  if (r?.skipped) {
    if (r.reason === 'brevo_api_nao_configurado') {
      return 'BREVO_API_KEY não configurado. Gere em Brevo → SMTP & API → API Keys.';
    }
    if (r.reason === 'mail_from_ausente') {
      return 'MAIL_FROM não configurado no servidor.';
    }
    if (r.reason === 'smtp_sem_senha') {
      return 'SMTP_PASS não configurado no servidor.';
    }
    return 'Servidor sem e-mail configurado (MAIL_FROM + BREVO_API_KEY ou SMTP).';
  }
  const base = r?.error || 'Falha ao enviar e-mail.';
  return `${base} — ${dicaParaErroSmtp(r?.error)}`;
}

module.exports = { dicaParaErroSmtp, formatMailError, formatMailErrorOps };

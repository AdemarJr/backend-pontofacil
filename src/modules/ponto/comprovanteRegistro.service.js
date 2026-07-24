const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const prisma = require('../../infra/prisma');
const { documentoParaExport, apenasDigitos } = require('../../shared/documentoIdentificacao');

const TIPO_LABEL = {
  ENTRADA: 'Entrada',
  SAIDA_ALMOCO: 'Saída intervalo',
  RETORNO_ALMOCO: 'Retorno intervalo',
  SAIDA: 'Saída',
};

function hashRegistro(registro) {
  const payload = [
    registro.nsr,
    registro.tenantId,
    registro.usuarioId,
    registro.dataHoraUtc ? new Date(registro.dataHoraUtc).toISOString() : '',
    registro.tipo,
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function fmtBrDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function fmtUtc(d) {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

async function carregarRegistroComprovante(registroId, tenantId, usuarioIdColaborador = null) {
  const registro = await prisma.registroPonto.findFirst({
    where: {
      id: registroId,
      tenantId,
      ...(usuarioIdColaborador ? { usuarioId: usuarioIdColaborador } : {}),
    },
    include: {
      usuario: { select: { id: true, nome: true, cpf: true, pis: true } },
      tenant: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } },
    },
  });
  return registro;
}

function renderComprovantePdf(doc, registro) {
  const hash = hashRegistro(registro);
  const docEmp = documentoParaExport(registro.usuario);
  const cnpj = apenasDigitos(registro.tenant?.cnpj);

  doc.fontSize(16).font('Helvetica-Bold').text('Comprovante de Registro de Ponto', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(9).font('Helvetica').fillColor('#666').text(
    'Documento administrativo REP-P (web). Assinatura ICP-Brasil pendente certificação.',
    { align: 'center' }
  );
  doc.moveDown(1.2);
  doc.fillColor('#000');

  doc.fontSize(11).font('Helvetica-Bold').text('Empregador');
  doc.font('Helvetica').fontSize(10);
  doc.text(registro.tenant?.razaoSocial || registro.tenant?.nomeFantasia || '—');
  doc.text(`CNPJ: ${cnpj || '—'}`);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').text('Trabalhador');
  doc.font('Helvetica');
  doc.text(registro.usuario?.nome || '—');
  doc.text(`CPF/PIS: ${docEmp || '—'}`);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').text('Marcação');
  doc.font('Helvetica');
  doc.text(`NSR: ${registro.nsr ?? '—'}`);
  doc.text(`Tipo: ${TIPO_LABEL[registro.tipo] || registro.tipo}`);
  doc.text(`Data/hora (servidor): ${fmtBrDateTime(registro.dataHora)}`);
  doc.text(`Data/hora UTC: ${fmtUtc(registro.dataHoraUtc || registro.dataHora)}`);
  doc.text(`Origem: ${registro.origem || '—'}`);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').text('Integridade');
  doc.font('Helvetica').fontSize(9);
  doc.text(`Hash SHA-256: ${hash}`, { width: 500 });
  doc.moveDown(1);
  doc.fontSize(8).fillColor('#888').text(
    `Gerado em ${fmtBrDateTime(new Date())} · PontoFácil REP-P`,
    { align: 'center' }
  );
}

async function gerarComprovantePdfStream(registroId, tenantId, usuarioIdColaborador = null) {
  const registro = await carregarRegistroComprovante(registroId, tenantId, usuarioIdColaborador);
  if (!registro) return null;

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  renderComprovantePdf(doc, registro);
  doc.end();
  return { doc, registro, hash: hashRegistro(registro) };
}

function urlComprovante(registroId) {
  return `/api/ponto/registros/${registroId}/comprovante.pdf`;
}

module.exports = {
  hashRegistro,
  carregarRegistroComprovante,
  renderComprovantePdf,
  gerarComprovantePdfStream,
  urlComprovante,
};

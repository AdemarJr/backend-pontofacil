// src/modules/folha/holerite-pdf.service.js
const PDFDocument = require('pdfkit');

function fmtBRL(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function gerarHoleritePdf({ tenant, usuario, holerite, periodo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(14).text(tenant.razaoSocial || tenant.nomeFantasia, { align: 'center' });
    doc.fontSize(10).text(`CNPJ: ${tenant.cnpj}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text('RECIBO DE PAGAMENTO', { align: 'center', underline: true });
    doc.fontSize(10).text(`Competência: ${String(periodo.mes).padStart(2, '0')}/${periodo.ano}`, { align: 'center' });
    doc.moveDown();

    doc.text(`Colaborador: ${usuario.nome}`);
    if (usuario.cpf) doc.text(`CPF: ${usuario.cpf}`);
    if (usuario.cargo) doc.text(`Cargo: ${usuario.cargo}`);
    doc.moveDown();

    const proventos = holerite.proventos || [];
    const descontos = holerite.descontos || [];

    doc.fontSize(11).text('PROVENTOS', { underline: true });
    doc.fontSize(9);
    for (const p of proventos) {
      doc.text(`${p.codigo} - ${p.descricao}  ${p.referencia || ''}  ${fmtBRL(p.valor)}`);
    }
    doc.moveDown();

    doc.fontSize(11).text('DESCONTOS', { underline: true });
    doc.fontSize(9);
    for (const d of descontos) {
      doc.text(`${d.codigo} - ${d.descricao}  ${d.referencia || ''}  ${fmtBRL(d.valor)}`);
    }
    doc.moveDown();

    const bases = holerite.bases || {};
    doc.fontSize(9).text(`Base INSS: ${fmtBRL(bases.inss || 0)}`);
    doc.text(`Base IRRF: ${fmtBRL(bases.irrf || 0)}`);
    doc.text(`FGTS (8%): ${fmtBRL(bases.fgts || 0)}`);
    doc.moveDown();

    doc.fontSize(12).text(`VALOR LÍQUIDO: ${fmtBRL(holerite.liquido)}`, { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#666').text(
      'Documento gerado pelo PontoFácil. Conferência pelo RH/contador é recomendada.',
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { gerarHoleritePdf, fmtBRL };

/**
 * Checagem de batida duplicada por tipo/dia — alinhada ao espelho:
 * - ignora registros excluídos (deletedAt)
 * - usa horário efetivo (ajuste.dataHoraNova quando existir)
 */

function inicioFimDoDiaLocal(ref) {
  const d = ref instanceof Date ? ref : new Date(ref);
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const fim = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { inicio, fim };
}

function dataHoraEfetiva(registro) {
  if (!registro) return null;
  return registro.ajuste?.dataHoraNova ?? registro.dataHora;
}

/**
 * @returns {Promise<{ id, tipo, dataHora, dataHoraEfetiva, origem, ajustado } | null>}
 */
async function buscarDuplicataDia(prismaClient, { tenantId, usuarioId, tipo, dataReferencia }) {
  const tipoUp = String(tipo || '').toUpperCase();
  const ref = dataReferencia instanceof Date ? dataReferencia : new Date(dataReferencia);
  if (Number.isNaN(ref.getTime())) return null;

  const { inicio, fim } = inicioFimDoDiaLocal(ref);

  const jaExiste = await prismaClient.registroPonto.findFirst({
    where: {
      tenantId,
      usuarioId,
      tipo: tipoUp,
      deletedAt: null,
      OR: [
        {
          ajuste: { is: null },
          dataHora: { gte: inicio, lte: fim },
        },
        {
          ajuste: { is: { dataHoraNova: { gte: inicio, lte: fim } } },
        },
      ],
    },
    select: {
      id: true,
      tipo: true,
      dataHora: true,
      origem: true,
      ajuste: { select: { dataHoraNova: true } },
    },
  });

  if (!jaExiste) return null;

  return {
    id: jaExiste.id,
    tipo: jaExiste.tipo,
    dataHora: jaExiste.dataHora,
    dataHoraEfetiva: dataHoraEfetiva(jaExiste),
    origem: jaExiste.origem,
    ajustado: Boolean(jaExiste.ajuste),
  };
}

function payloadDuplicataDia(conflito, mensagem) {
  return {
    error:
      mensagem ||
      'Já existe uma batida desse tipo neste dia (horário efetivo). Em vez de inserir, ajuste a batida existente.',
    code: 'DUPLICADO_DIA',
    registroId: conflito.id,
    tipo: conflito.tipo,
    dataHora: conflito.dataHora,
    dataHoraEfetiva: conflito.dataHoraEfetiva,
    origem: conflito.origem,
    ajustado: conflito.ajustado,
  };
}

module.exports = {
  inicioFimDoDiaLocal,
  dataHoraEfetiva,
  buscarDuplicataDia,
  payloadDuplicataDia,
};

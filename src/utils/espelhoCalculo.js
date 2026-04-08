/**
 * Cálculo de espelho diário: horas trabalhadas, extras, flags e comparação com escala.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function minutesBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 1000 / 60);
}

function fmtHours(min) {
  const sign = min < 0 ? '-' : '';
  const v = Math.abs(min);
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

/** Segunda=1 … domingo=7 (ISO 8601 weekday) */
function diaSemanaISO(d) {
  const day = new Date(d).getDay();
  return day === 0 ? 7 : day;
}

function parseHoraMinutos(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutosDoDia(dataHora) {
  const dt = new Date(dataHora);
  return dt.getHours() * 60 + dt.getMinutes();
}

/**
 * @param {Array<{tipo:string,dataHora:string|Date}>} pontos
 * @param {{ escala?: object|null, toleranciaMinutos?: number, dataRef?: string }} opts dataRef 'YYYY-MM-DD' para checar dia da semana
 */
function calcularDia(pontos, opts = {}) {
  const { escala, toleranciaMinutos = 5, dataRef } = opts;

  const sorted = [...pontos].sort((a, b) => new Date(a.dataHora) - new Date(b.dataHora));
  const getTipo = (t) => String(t || '').toUpperCase();
  const byTipo = (tipo) => sorted.find((p) => getTipo(p.tipo) === tipo) || null;

  const entrada = byTipo('ENTRADA');
  const saidaAlmoco = byTipo('SAIDA_ALMOCO');
  const retornoAlmoco = byTipo('RETORNO_ALMOCO');
  const saida = byTipo('SAIDA');

  const intervaloMin =
    saidaAlmoco && retornoAlmoco
      ? minutesBetween(saidaAlmoco.dataHora, retornoAlmoco.dataHora)
      : null;

  let minutosTrabalhados = 0;
  if (entrada && saidaAlmoco) minutosTrabalhados += minutesBetween(entrada.dataHora, saidaAlmoco.dataHora);
  if (retornoAlmoco && saida) minutosTrabalhados += minutesBetween(retornoAlmoco.dataHora, saida.dataHora);
  if (minutosTrabalhados === 0 && entrada && saida) {
    minutosTrabalhados = minutesBetween(entrada.dataHora, saida.dataHora);
  }

  const intervaloMinimo =
    escala && escala.intervaloMinutos != null ? escala.intervaloMinutos : 60;

  const jornadaPadraoMin =
    escala && escala.cargaHorariaDiaria != null
      ? Math.round(Number(escala.cargaHorariaDiaria) * 60)
      : 8 * 60;

  const extrasMin = Math.max(0, minutosTrabalhados - jornadaPadraoMin);
  const deficitMin = Math.max(0, jornadaPadraoMin - minutosTrabalhados);

  const faltandoMarcacao =
    !entrada ||
    !saida ||
    Boolean(saidaAlmoco) !== Boolean(retornoAlmoco);

  const intervaloInsuficiente = intervaloMin != null && intervaloMin < intervaloMinimo;

  const jornadaExcedida = minutosTrabalhados > jornadaPadraoMin;

  let entradaAtrasada = false;
  let saidaAntecipada = false;
  let almocoForaDaJanela = false;

  let escalaAplicavel = null;
  if (escala && dataRef) {
    const d = new Date(dataRef + 'T12:00:00');
    const dow = diaSemanaISO(d);
    if (Array.isArray(escala.diasSemana) && escala.diasSemana.includes(dow)) {
      escalaAplicavel = escala;
    }
  } else if (escala && !dataRef) {
    escalaAplicavel = escala;
  }

  if (escalaAplicavel) {
    const espEntrada = parseHoraMinutos(escalaAplicavel.horaInicio);
    const espSaida = parseHoraMinutos(escalaAplicavel.horaFim);
    const tol = Number(toleranciaMinutos) || 0;

    if (espEntrada != null && entrada) {
      entradaAtrasada = minutosDoDia(entrada.dataHora) > espEntrada + tol;
    }
    if (espSaida != null && saida) {
      saidaAntecipada = minutosDoDia(saida.dataHora) < espSaida - tol;
    }

    const espSaiAlmoco = parseHoraMinutos(escalaAplicavel.horaSaidaAlmoco);
    const espRetAlmoco = parseHoraMinutos(escalaAplicavel.horaRetornoAlmoco);
    if (espSaiAlmoco != null && saidaAlmoco) {
      const t = minutosDoDia(saidaAlmoco.dataHora);
      if (t > espSaiAlmoco + tol) almocoForaDaJanela = true;
    }
    if (espRetAlmoco != null && retornoAlmoco) {
      const t = minutosDoDia(retornoAlmoco.dataHora);
      if (t < espRetAlmoco - tol) almocoForaDaJanela = true;
    }
  }

  return {
    entrada: entrada?.dataHora ?? null,
    saidaAlmoco: saidaAlmoco?.dataHora ?? null,
    retornoAlmoco: retornoAlmoco?.dataHora ?? null,
    saida: saida?.dataHora ?? null,
    intervaloMin,
    minutosTrabalhados,
    jornadaContratualMin: jornadaPadraoMin,
    extrasMin,
    deficitMin,
    flags: {
      faltandoMarcacao,
      intervaloInsuficiente,
      jornadaExcedida,
      entradaAtrasada,
      saidaAntecipada,
      almocoForaDaJanela,
    },
    esperado: escalaAplicavel
      ? {
          entrada: escalaAplicavel.horaInicio,
          saida: escalaAplicavel.horaFim,
          intervaloMinimo: intervaloMinimo,
          cargaHorariaDiaria: escalaAplicavel.cargaHorariaDiaria,
        }
      : null,
  };
}

function escalaParaDia(listaEscalasOrdenadas, dataRef) {
  if (!listaEscalasOrdenadas?.length) return null;
  const d = new Date(dataRef + 'T12:00:00');
  const dow = diaSemanaISO(d);
  return listaEscalasOrdenadas.find((e) => e.ativo !== false && Array.isArray(e.diasSemana) && e.diasSemana.includes(dow)) || null;
}

module.exports = {
  calcularDia,
  diaSemanaISO,
  escalaParaDia,
  fmtHours,
  fmtTime,
  minutesBetween,
  pad2,
};

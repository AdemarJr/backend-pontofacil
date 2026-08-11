/**
 * Smoke tests: turno noturno / sequência cross-midnight.
 * Run: node src/modules/ponto/sequenciaMarcacao.overnight.test.js
 */
const assert = require('assert');
const {
  resolverProximoTipo,
  turnoAbertoContinua,
  determinarProximoTipo,
  LIMITE_TURNO_ABERTO_HORAS,
} = require('./sequenciaMarcacao');
const {
  agruparPontosPorDiaJornada,
  escalaCruzaMeiaNoite,
  calcularDia,
} = require('../../utils/espelhoCalculo');

function ok(name) {
  console.log(`  ✓ ${name}`);
}

// --- sequência ---
{
  const entrada = { tipo: 'ENTRADA', dataHora: new Date('2026-08-10T18:00:00') };
  const saidaMoment = new Date('2026-08-11T06:00:00');

  assert.strictEqual(
    resolverProximoTipo(entrada, saidaMoment, { modoMarcacao: 'DUAS_BATIDAS' }),
    'SAIDA',
    'vigilante 18→6 deve sugerir SAIDA'
  );
  ok('resolverProximoTipo overnight DUAS_BATIDAS → SAIDA');

  assert.strictEqual(
    resolverProximoTipo(entrada, saidaMoment, { modoMarcacao: 'QUATRO_BATIDAS' }),
    'SAIDA_ALMOCO',
    'em 4 batidas após ENTRADA vem SAIDA_ALMOCO'
  );
  ok('resolverProximoTipo overnight QUATRO → SAIDA_ALMOCO');

  assert.ok(turnoAbertoContinua(entrada, saidaMoment, { modoMarcacao: 'DUAS_BATIDAS' }));
  ok('turnoAbertoContinua true em ~12h');

  const tardeDemais = new Date('2026-08-11T12:00:00'); // 18h depois
  assert.ok(
    !turnoAbertoContinua(entrada, tardeDemais, {
      modoMarcacao: 'DUAS_BATIDAS',
      limiteHoras: LIMITE_TURNO_ABERTO_HORAS,
    })
  );
  assert.strictEqual(
    resolverProximoTipo(entrada, tardeDemais, { modoMarcacao: 'DUAS_BATIDAS' }),
    'ENTRADA'
  );
  ok('após limite, volta a ENTRADA');

  // diurno mesmo dia
  const ent8 = { tipo: 'ENTRADA', dataHora: new Date('2026-08-11T08:00:00') };
  const agora12 = new Date('2026-08-11T12:00:00');
  assert.strictEqual(resolverProximoTipo(ent8, agora12, { modoMarcacao: 'DUAS_BATIDAS' }), 'SAIDA');
  ok('diurno mesmo dia continua SAIDA');

  assert.strictEqual(determinarProximoTipo('SAIDA', 'DUAS_BATIDAS'), 'ENTRADA');
  ok('após SAIDA, próxima é ENTRADA');
}

// --- agrupamento espelho ---
{
  const pontos = [
    { id: '1', tipo: 'ENTRADA', dataHora: '2026-08-10T18:05:00' },
    { id: '2', tipo: 'SAIDA', dataHora: '2026-08-11T06:10:00' },
  ];
  const porDia = agruparPontosPorDiaJornada(pontos);
  assert.ok(porDia['2026-08-10']);
  assert.strictEqual(porDia['2026-08-10'].length, 2);
  assert.ok(!porDia['2026-08-11']);
  ok('agruparPontosPorDiaJornada coloca saída no dia da entrada');

  const calc = calcularDia(porDia['2026-08-10'], {
    dataRef: '2026-08-10',
    modoMarcacao: 'DUAS_BATIDAS',
    escala: {
      horaInicio: '18:00',
      horaFim: '06:00',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      cargaHorariaDiaria: 12,
      intervaloMinutos: 0,
    },
  });
  assert.ok(calc.entrada);
  assert.ok(calc.saida);
  assert.ok(!calc.flags.faltandoMarcacao);
  assert.ok(calc.minutosTrabalhados > 11 * 60);
  ok('calcularDia overnight fecha jornada no dia do plantão');

  assert.ok(escalaCruzaMeiaNoite({ horaInicio: '18:00', horaFim: '06:00' }));
  assert.ok(!escalaCruzaMeiaNoite({ horaInicio: '08:00', horaFim: '17:00' }));
  ok('escalaCruzaMeiaNoite');
}

console.log('\nTodos os testes de turno noturno passaram.\n');

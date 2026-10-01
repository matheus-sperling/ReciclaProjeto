const test = require('node:test');
const assert = require('node:assert/strict');
const { lerQr, moradorId, pesoKg, validar } = require('../coletor/core.js');
const config = { municipio: 'Coxim', uf: 'MS', demonstrativo: true,
  materiais: [{ id: 'papel', nome: 'Papel' }],
  pontos: [{ id: 1, nome: 'PEV Centro', ativo: true }, { id: 2, nome: 'PEV Sul', ativo: false }] };
test('QR aceita somente o contrato Recicla+ e um identificador válido', () => {
  assert.equal(lerQr(' recicla:morador:morador-001 '), 'morador-001');
  for (const value of ['https://example.com', 'morador-001', 'recicla:morador:', 'recicla:morador:<script>', 'recicla:morador:Nome Sobrenome', 'recicla:morador:' + 'a'.repeat(65)]) {
    assert.throws(() => lerQr(value));
  }
  assert.equal(moradorId(' abc_123 '), 'abc_123');
});
test('peso preserva gramas e recusa formatos ambíguos ou fora do limite', () => {
  assert.equal(pesoKg('2,500'), 2.5);
  assert.equal(pesoKg('0.001'), 0.001);
  assert.equal(pesoKg('10000'), 10000);
  for (const value of ['0', '-1', '10000.001', '1,000.5', '1.000,5', '1e3', 'Infinity', '', '0,0001', '2kg']) {
    assert.throws(() => pesoKg(value));
  }
});
test('entrega vincula apenas material conhecido e ponto ativo', () => {
  const form = { moradorId: 'morador-001', pontoId: '1', materialId: 'papel', kg: '1,125' };
  const entrega = validar(form, config);
  assert.equal(entrega.kg, 1.125);
  assert.equal(entrega.pontoNome, 'PEV Centro');
  assert.equal(entrega.demonstrativo, true);
  assert.equal(entrega.municipio, 'Coxim');
  for (const patch of [{ pontoId: '2' }, { pontoId: '999' }, { materialId: 'outro' }, { moradorId: '' }]) {
    assert.throws(() => validar({ ...form, ...patch }, config));
  }
});

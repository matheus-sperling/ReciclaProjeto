/* Regras do formulário, sem dependências ou acesso ao navegador. */
(function (root) {
  'use strict';
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  function moradorId(value) {
    const id = String(value || '').trim();
    if (!ID.test(id)) throw new Error('Use um identificador de até 64 caracteres, com letras, números, hífen ou sublinhado.');
    return id;
  }
  function lerQr(value) {
    const text = String(value || '').trim();
    if (!text.startsWith('recicla:morador:')) throw new Error('Este QR não é do Recicla+. Use um código no formato recicla:morador:ID.');
    return moradorId(text.slice('recicla:morador:'.length));
  }
  function pesoKg(value) {
    const text = String(value || '').trim();
    if (!/^\d+(?:[.,]\d{1,3})?$/.test(text)) throw new Error('Informe o peso em kg, com até três casas decimais. Exemplo: 2,500.');
    const kg = Number(text.replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0 || kg > 10000) throw new Error('O peso deve ser maior que zero e de até 10.000 kg.');
    return kg;
  }
  function validar(form, config) {
    const id = moradorId(form.moradorId);
    const material = config.materiais.find(m => m.id === form.materialId);
    const ponto = config.pontos.find(p => p.id === Number(form.pontoId) && p.ativo);
    if (!material) throw new Error('Selecione o material entregue.');
    if (!ponto) throw new Error('Selecione um ponto de coleta ativo.');
    return { moradorId: id, materialId: material.id, materialNome: material.nome,
      pontoId: ponto.id, pontoNome: ponto.nome, kg: pesoKg(form.kg),
      municipio: config.municipio, uf: config.uf, demonstrativo: config.demonstrativo };
  }
  const api = { moradorId, lerQr, pesoKg, validar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReciclaCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

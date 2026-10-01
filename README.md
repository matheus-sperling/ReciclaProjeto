# Recicla+

Protótipo de coleta seletiva para municípios de Mato Grosso do Sul, publicado na Vercel. HTML, CSS e JavaScript estáticos, sem build.

## Telas

- `/`: painel demonstrativo de Coxim. O `index.html` original foi preservado.
- `/coletor`: leitura de QR pela câmera, entrada manual do identificador, conferência de material/ponto/peso, registro local e histórico com exportação JSON.

O coletor usa o tema escolhido no painel e um layout voltado a telas móveis. Os pontos e materiais partem dos dados demonstrativos do painel. Pontos em manutenção não aceitam novas entregas.

## Vercel

Manter o projeto conectado a este repositório. Usar o preset **Other**, sem comando de build, com a raiz do repositório como diretório publicado. `vercel.json` encaminha `/coletor` para `/coletor/index.html`. O painel continua em `/`.

## Uso offline

1. Abra `/coletor` com internet pela Vercel (HTTPS).
2. Aguarde **Pronto para uso offline**. Isso confirma o cache da interface e das três dependências CDN.
3. Adicione à tela inicial pelo menu do navegador, quando essa opção estiver disponível. A instalação não é necessária para registrar entregas offline.
4. Sem rede, reabra `/coletor` e registre entregas. A câmera depende de permissão do navegador; a entrada manual também funciona offline.

O service worker tem escopo `/coletor`: ele não controla nem coloca o mapa do gestor em cache. Uma atualização aguarda o fechamento das telas abertas do coletor. Ao modificar seus recursos, incrementar `CACHE` em `coletor-sw.js`.

## Identificador do morador

O contrato inicial de QR é `recicla:morador:morador-001`. O identificador aceita até 64 caracteres (letras ASCII, números, hífen e sublinhado), iniciando por letra ou número. Na entrada manual, informar somente `morador-001`.

QRs de outros formatos são recusados. O QR é lido pela biblioteca html5-qrcode 2.3.8, sem implementação própria de decodificação. Não há geração de QR, cadastro de moradores ou comprovação de identidade nesta versão.

## Entregas locais

Dexie 4 usa IndexedDB com banco `recicla`, versão 1, tabela `entregas`. Esquema:

```js
db.version(1).stores({ entregas: 'id, moradorId, pontoId, materialId, criadoEm, status' });
```

Cada entrega contém UUID, identificador do morador, ponto e material com nomes, peso em kg, município/UF, indicador demonstrativo, data/hora ISO e `status: 'local'`. O horário é apresentado no fuso de Mato Grosso do Sul. O peso aceita até três casas decimais, deve ser positivo e não pode ultrapassar 10.000 kg. Salvar exige confirmação; leituras repetidas de câmera não registram entregas automaticamente.

O histórico e sua exportação JSON incluem os registros deste navegador e desta origem. **Ainda não existe API, autenticação ou sincronização com o painel do gestor.** O painel continua exibindo seus dados demonstrativos.

Exportar prepara um arquivo com todas as entregas; não apaga dados e não os envia a outro dispositivo. Limpar os dados do navegador remove o banco. Endereços de preview e produção têm bancos separados; use o endereço definitivo para a coleta.

## Verificação

Regras do formulário: `node --test tests/core.test.cjs`.

Na revisão em navegador, verificar: registro e persistência após recarga, abertura e salvamento sem rede após preparo do cache, exportação JSON, tratamento de permissão de câmera, QR fora do formato e largura de 360 px sem rolagem horizontal. A leitura física da câmera deve ser verificada também em um celular com HTTPS.

# AGENTS.md — Recicla+ (v0)

Plataforma de coleta seletiva para municípios de MS. Moradores têm QR pessoal; coletores registram entregas; gestores acompanham o painel. Preserve a identidade visual, o mapa Leaflet, o gráfico Chart.js e os temas existentes.

## Telas
- `/`: painel do gestor, web 16:9, cadastros de moradores, QR, equipe e pontos.
- `/coletor`: aplicativo mobile 9:16, PWA com fila offline e sincronização automática.

## Bibliotecas
Vue 3.5.13, Tailwind 4.1.13, html5-qrcode 2.3.8, Leaflet 1.9.4, Chart.js 4.4.8 e QRious 4.0.2 via CDN. Backend Node 24, SDK oficial `@vercel/blob` e `jose`.

## Armazenamento
Somente Vercel Blob **privado**, com documentos JSON acessados pelo backend `/api/recicla`. Não adicionar Dexie, IndexedDB de entregas, Postgres ou serviços externos de banco. `localStorage` é apenas cache de cadastros, recibos e fila temporária de envio, separada por usuário. A API é a autoridade dos dados; o painel só soma registros recebidos no servidor.

## Regras
- Não reinventar mapa, gráfico, leitor/gerador de QR ou armazenamento remoto.
- Segredos exclusivamente no ambiente da Vercel; nunca no cliente ou GitHub.
- Autenticação por cookie HttpOnly; autorização por perfil e município no servidor.
- Cada entrega tem UUID imutável. Reenvios idênticos retornam o mesmo recibo, sem duplicação.
- Escritas em documentos existentes usam ETag/ifMatch; novos registros não podem sobrescrever arquivos.
- Não informar prontidão offline antes de verificar todos os arquivos e bibliotecas em cache.
- Testar o fluxo gestor → cadastro/QR → coletor → offline → envio → painel antes de declarar funcionamento completo.

## Validação
`npm ci` e `npm test`. As funções ficam em `api/`, com domínio em `server/`. Para verificar na Vercel, conecte primeiro o Blob privado e as variáveis documentadas no README. Não simular persistência em produção.

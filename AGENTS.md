# AGENTS.md — Recicla+ (v0)

Plataforma de coleta seletiva para municípios de MS. Moradores têm QR pessoal; coletores leem o QR e registram a entrega; gestores veem o painel.

## Telas

- `/` — painel do gestor, web 16:9.
- `/coletor` — app do coletor, mobile 9:16, PWA offline, com layout adaptável à altura da tela.

## Bibliotecas permitidas (CDN)

Vue 3, Tailwind 4, Dexie 4, html5-qrcode 2.3.8, Leaflet 1.9.4 e Chart.js 4.4.8.

## Banco local

Dexie, banco `recicla`, versão 1, tabela `entregas`.

## Regras

- Não reinventar mapa, gráfico, QR nem banco local.
- Preservar o painel existente, incluindo Leaflet, Chart.js e temas claro/escuro.
- Manter a hospedagem na Vercel e a execução sem build.
- As entregas do coletor são locais nesta versão; não indicar sincronização enquanto não houver integração central.
- Ao alterar recursos do coletor, atualizar a versão do cache em `coletor-sw.js` e verificar a abertura offline.

## QR do morador (contrato inicial)

Conteúdo: `recicla:morador:ID`. O ID tem de 1 a 64 caracteres: letras ASCII, números, hífen ou sublinhado, iniciando por letra ou número. Não incluir nome ou CPF. A entrada manual aceita apenas o ID. Não há emissão de QR, cadastro ou validação de identidade nesta versão.

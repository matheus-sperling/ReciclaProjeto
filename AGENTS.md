# Recicla+

O usuário autorizou a substituição do Blob por Neon/PostgreSQL e a reformulação completa com Vue. Mantenha Vue 3, TypeScript, Vite, dependências fixadas e o histórico deste repositório. A preferência atual é entregar na `main` após as verificações.

- Nunca use o proprietário do banco em `DATABASE_URL`. O servidor verifica `recicla_app_login`, sem propriedade/BYPASSRLS, membro de `recicla_app`. Use `recicla_auth_login`, membro de `recicla_auth`, apenas nos fluxos de autenticação e equipe com escopo explícito. As roles de grupo não recebem login.
- Toda operação municipal deve usar `scoped` dentro de uma transação. Perfil e cidade vêm de `principal`, nunca do cliente. Administrador precisa selecionar uma cidade; não adicionamos administradores por HTTP.
- Gestores podem administrar outros gestores e coletores do próprio município. Preserve o bloqueio de conta própria e o mutex transacional do último gestor.
- Pesos são gramas inteiras no banco. UUID de entrega e QR `recicla:morador:UUID` são imutáveis. Reenvios idênticos retornam recibos; alterações conflitam.
- APIs não entram no cache do service worker. LocalStorage nunca guarda tokens/senhas; pendências pertencem à conta original e só saem após guardar recibo.
- Não adicione dados demonstrativos à produção. Os scripts de teste exigem banco local descartável com nome `recicla_test`.
- Execute `npm run typecheck`, testes de segurança com PostgreSQL real, `npm run build` e `npm run test:browser` para mudanças substanciais. Mantenha claro quais verificações dependem de celular real/produção.
- Não versionar `.env`, senhas, códigos de recuperação ou dados operacionais. Leia `docs/OPERACAO.md` para provisionamento e recuperação.

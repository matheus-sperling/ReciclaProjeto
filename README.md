# Recicla+ · Gestão municipal da coleta seletiva

Aplicação Vue 3 para municípios de Mato Grosso do Sul. O mesmo repositório mantém todo o histórico do projeto. A persistência atual usa PostgreSQL/Neon, Prisma e isolamento por município; o Vercel Blob foi retirado.

## Funcionalidades

- Painel com período no fuso `America/Campo_Grande`, mapa Leaflet, gráfico Chart.js e indicadores calculados no servidor.
- Municípios, moradores/QR, pontos e equipe em páginas próprias, com busca, paginação e edição.
- Gestores administram outros gestores e coletores da própria cidade. Administrador global escolhe explicitamente a cidade. Coletores acessam catálogo e seu próprio histórico.
- Better Auth com sessões verificadas no banco, cookies HttpOnly e autenticação TOTP obrigatória para o administrador. Primeiro administrador pela página `/ativar`, com código privado de uso único e prazo de validade. Sem cadastro público livre, senha padrão ou promoção a administrador por API.
- Coleta por câmera, imagem ou código manual; revisão, fila offline por usuário/cidade, recibos idempotentes, exportação e sincronização com aplicativo aberto.
- Tema claro por padrão, opção escura, interface responsiva, estados vazios/erro/carregamento e diálogos acessíveis.

## Estrutura do repositório

| Pasta      | Responsabilidade                                                  |
| ---------- | ----------------------------------------------------------------- |
| `src/`     | Telas Vue, componentes compartilhados, navegação e coleta offline |
| `server/`  | Autenticação, autorização, regras municipais e acesso ao banco    |
| `shared/`  | Contratos e validações usados pelo cliente e pelo servidor        |
| `api/`     | Entradas das funções Node publicadas na Vercel                    |
| `prisma/`  | Modelo de dados e migrações versionadas, incluindo RLS            |
| `tests/`   | Verificação de segurança, autenticação, fila offline e telas      |
| `scripts/` | Provisionamento protegido, criação e recuperação do administrador |
| `docs/`    | Configuração, publicação, backup e procedimentos operacionais     |
| `public/`  | Arquivos públicos estáticos; sem dados operacionais ou segredos   |

As regras de permissão ficam no servidor. Componentes de interface e contratos compartilhados não recebem credenciais do banco. Saídas de build, relatórios e arquivos de ambiente estão fora do versionamento.

## Desenvolvimento

Use Node 24 e npm. Instale com `npm ci` e gere o cliente com `npm run db:generate`. Copie `.env.example` para `.env.local` e configure as credenciais descritas em [Operação](docs/OPERACAO.md).

`npm run dev` inicia a aplicação e as APIs no mesmo endereço `http://localhost:5173`. `APP_ORIGIN` deve ser exatamente igual ao endereço aberto. Para verificar o coletor offline use `npm run build` seguido de `node --import tsx server/local.ts --preview`; o service worker é produzido no build. Câmera exige HTTPS ou localhost.

## Verificações

```sh
npm run typecheck
npm run check:api
npm run test:setup
npm test
npm audit --audit-level=high
npm run build
npx playwright install chromium
npm run test:browser
```

Os testes de integração exigem PostgreSQL real em um banco descartável local chamado `recicla_test`, indicado por `TEST_DATABASE_URL`. `test:setup` recria **somente esse banco de teste**, aplica as migrações e cria dois municípios com contas fictícias. O GitHub Actions provisiona automaticamente PostgreSQL 17 e executa esses comandos. Não use esse procedimento em produção.

Credenciais públicas **exclusivamente dos testes**: `gestor-a@teste.invalid`, `coletor-a@teste.invalid` e equivalentes `-b`, senha `Teste-local-frase-2026!`. Esses registros não são criados pelas migrações de produção. O teste usa `recicla_app_login` e `recicla_auth_login`, com as mesmas permissões de grupo da produção, para garantir que o isolamento não depende de privilégios do proprietário.

## Publicação

Vercel executa o build Vite e as funções Node em `/api/recicla?action=...` e `/api/auth/*`. A produção acompanha a `main`. Configure o banco novo e as credenciais antes da publicação; habilite um código privado temporário e abra `/ativar` para criar o primeiro administrador pelo navegador. A página usa a conexão de autenticação do servidor, sem solicitar conexão do banco ao usuário. Nenhum registro do Blob é importado. [Guia de operação e recuperação](docs/OPERACAO.md) e [roteiro de validação](docs/VALIDACAO.md).

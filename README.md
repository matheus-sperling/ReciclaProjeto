# Recicla+

Painel municipal e coletor PWA, preservando o dashboard original. O gestor cadastra moradores e emite QR pessoais, administra equipe e pontos de coleta, e acompanha as entregas efetivamente recebidas no servidor.

Para apresentar o projeto, siga o [guia rápido de demonstração](GUIA-DEMONSTRACAO.md).

## Arquitetura

- `/`: Vue 3, Tailwind 4, Leaflet/OpenStreetMap e Chart.js, com período selecionável e atualização automática a cada 15 segundos.
- `/coletor`: Vue 3, html5-qrcode, câmera, leitura de imagem ou entrada manual, conferência de peso e histórico.
- `/api/recicla`: Vercel Function Node 24, autenticação por cookie HttpOnly/SameSite, perfis gestor/coletor e isolamento por município.
- Vercel Blob **privado**: contas com senha scrypt, cadastros e entregas em arquivos JSON. O navegador nunca recebe o token do Blob nem os hashes de senha.
- PWA: arquivos públicos em Cache Storage; cadastros, recibos e fila temporária no `localStorage`, separados por usuário. Não há Dexie.

O QR contém apenas `recicla:morador:UUID`. O servidor valida o cadastro ativo, o ponto, o material, o peso, a data e a conta responsável. Pesos admitem três casas decimais; o painel soma em gramas. Um UUID identifica uma única entrega, mesmo com reenvio ou envio concorrente.

## Configuração na Vercel

1. No projeto `reciclaprojeto`, crie/conecte um **Blob Store privado** em Storage, para Production e Preview. Um store público não serve para esta aplicação.
2. Configure `BLOB_READ_WRITE_TOKEN` (a conexão do store normalmente fornece esta variável). Também é possível usar autenticação OIDC do Blob com `BLOB_STORE_ID` e token gerenciado da Vercel.
3. Configure dois valores diferentes e aleatórios, com pelo menos 32 caracteres: `AUTH_SECRET` para sessões e `RECICLA_SETUP_TOKEN` para criar o primeiro gestor. Gere-os num ambiente privado com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Nunca os publique no GitHub.
4. Opcional: `RECICLA_BLOB_PREFIX=recicla-v1`. Para previews de teste, use um store separado ou um prefixo exclusivo, por exemplo `recicla-preview`; isso evita alterar dados de produção.
5. Mantenha Framework Preset **Other**, sem Build Command nem Output Directory customizado, Node **24.x** e diretório raiz do repositório. Reimplante depois de alterar variáveis.
6. Abra `/`, informe o código de configuração e crie seu gestor com senha de pelo menos 12 caracteres. O primeiro cadastro só acontece uma vez. Depois remova `RECICLA_SETUP_TOKEN` do ambiente e reimplante; novas contas são criadas em Cadastros → Equipe.

`.env.example` descreve as variáveis sem valores secretos. O acesso inicial informa configuração pendente enquanto o store e os segredos não estiverem disponíveis. Não existe login padrão nem senha embutida.

## Operação

1. Gestor: revise os pontos demonstrativos de Coxim em **Cadastros → Pontos**, substituindo nomes, endereços e coordenadas pelos locais oficiais. Outros municípios começam sem pontos.
2. Cadastre o morador em **Moradores**, baixe o QR e entregue-o à pessoa. Crie uma conta do coletor em **Equipe**.
3. Coletor: abra `/coletor` com internet, entre e aguarde **Pronto para uso offline**. Clique em **Atualizar cadastros** antes de sair para a coleta. Apenas moradores e pontos presentes no catálogo baixado podem ser usados offline.
4. Leia o QR pela câmera, escolha uma imagem do QR ou informe o UUID. Selecione ponto/material, informe o peso e confirme.
5. Sem conexão, a entrega fica **Aguardando envio**. Ao reconectar, a aplicação aberta envia automaticamente e só remove a fila após guardar o recibo do servidor. Sessão expirada exige novo login na mesma conta; a fila permanece preservada.
6. O gestor verá os quilogramas no período correspondente à data da coleta, no fuso de MS, após o servidor confirmar o recebimento.

A sincronização ocorre com a aplicação aberta; não depende de execução em segundo plano do sistema operacional. Cadastros desativados podem provocar rejeição de uma entrega offline: ela permanece na fila com o motivo visível para resolução pelo gestor. Exporte o JSON antes de limpar dados do navegador. Limpar armazenamento, usar modo privado ou trocar de aparelho pode apagar entregas ainda pendentes. O histórico central continua no Blob.

## Limites do Blob nesta versão

Blob armazena arquivos, não tabelas SQL. As listagens leem documentos e agregam as entregas no servidor. Esta implementação atende a v0; o custo e a duração das consultas crescem com o número de arquivos. Valide volume real e limites da Vercel antes de expandir a operação municipal. Arquivos de limitação de tentativas de login devem ser considerados na manutenção do store. Não há exclusão automática de registros.

## Verificação

```sh
npm ci
npm test
```

Os testes de domínio usam um adaptador em memória somente dentro dos testes e verificam permissões, senhas/sessões, cadastro, rejeições, soma de pesos e idempotência concorrente. O fluxo de interface também precisa ser verificado no navegador e no ambiente publicado, incluindo escrita/leitura no Blob real. Câmera física exige HTTPS, permissão e teste em celular.

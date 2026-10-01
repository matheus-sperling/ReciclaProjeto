# Ativação, publicação e recuperação

## Banco novo no Neon

Crie um projeto PostgreSQL para a produção, sem importar os registros antigos de teste. Use uma branch/banco separado para desenvolvimento e outra para previews. Nunca aponte preview ou GitHub Actions para o banco operacional.

O proprietário recebe a conexão direta (sem pool) em `DIRECT_URL`, apenas num terminal ou job protegido de migração. Execute `npm ci`, `npm run db:generate`, `npm run db:migrate`. Isso cria as tabelas, vínculos compostos, materiais originais e políticas RLS. Consulte a [documentação de RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Defina `APP_DB_PASSWORD` e `AUTH_DB_PASSWORD` com senhas aleatórias distintas de 32 a 128 caracteres base64url e execute uma vez `npm run db:provision` em um ambiente administrativo protegido, com `DIRECT_URL` apontando para o banco. O procedimento cria `recicla_app_login` e `recicla_auth_login` com `NOBYPASSRLS`, sem privilégios de criação, e concede a cada uma sua role de grupo sem login. Não crie logins operacionais pela interface do Neon sem confirmar `NOBYPASSRLS`: logins com `BYPASSRLS` anulam o isolamento municipal. A role de aplicação acessa registros municipais sob RLS. A role de autenticação acessa somente contas, autenticação, vínculo da cidade e escrita de auditoria; o servidor controla cada operação administrativa de equipe. A credencial de autenticação é sensível e não deve aparecer no frontend.

Configure na Vercel, individualmente em Production e Preview:

| Variável             | Valor                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`       | Conexão PostgreSQL usando `recicla_app_login`; SSL no Neon                    |
| `AUTH_DATABASE_URL`  | Conexão PostgreSQL usando `recicla_auth_login`; SSL no Neon                   |
| `BETTER_AUTH_SECRET` | Pelo menos 32 bytes aleatórios, exclusivos por ambiente                       |
| `APP_ORIGIN`         | Origem HTTPS exata, sem barra final, por exemplo `https://recicla.exemplo.br` |

Gere segredos em um gerenciador de senhas ou com `crypto.randomBytes(32).toString('base64url')`. Não use exemplos como senha. Não defina `DIRECT_URL`, senhas de bootstrap ou credencial proprietária nas funções da Vercel. O servidor recusa uma `DATABASE_URL` com role incorreta ou capaz de ignorar o isolamento.

Para previews com URLs variáveis, configure a origem exata do preview e um banco separado antes da validação; não permita curingas de origem. Um preview sem essas variáveis exibe aviso de configuração e mantém as APIs fechadas.

## Administrador inicial

O fluxo recomendado é pelo próprio site, na página **`/ativar`**, disponível nos temas claro e escuro. O banco e os quatro valores de execução acima devem estar funcionando. O usuário informa somente código de ativação, nome, e-mail e senha inicial de pelo menos 12 caracteres; nenhuma conexão do banco é solicitada no formulário.

Uma pessoa autorizada com acesso às configurações Vercel gera um código com 256 bits aleatórios e validade de 48 horas:

```sh
node -e "console.log((Date.now()+48*60*60*1000)+'.'+require('node:crypto').randomBytes(32).toString('hex'))"
```

Cadastre esse valor como variável **Secret** `ADMIN_SETUP_TOKEN`, somente no ambiente pretendido, e publique novamente para ativá-la. Entregue o código em canal privado. Nunca use prefixo `VITE_`, parâmetro na URL, código de exemplo, arquivo público ou GitHub. O código é uma credencial temporária: quem o possuir enquanto não houver administrador pode criar essa primeira conta.

O servidor verifica origem, validade, código em tempo constante, limites por IP e por instalação, e cria conta, senha cifrada por hash e auditoria numa única transação. A trava transacional e o índice único impedem dois administradores mesmo com pedidos simultâneos. Depois da criação, o servidor bloqueia novas ativações, incluindo se a conta estiver inativa ou removida. A página não redefine contas existentes. Remova `ADMIN_SETUP_TOKEN` da Vercel após concluir e publique novamente; o bloqueio do banco já vale imediatamente, sem depender dessa limpeza.

Como alternativa administrativa local, existe `node --import tsx scripts/create-admin.ts --interactive`. Ele usa a mesma criação transacional e recebe nome, e-mail, conexão privada e senha sem gravá-los em arquivos. Não é necessário para o primeiro acesso pelo site.

No terminal protegido, configure `AUTH_DATABASE_URL`, `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo 12 caracteres). Execute `npm run admin:create` e retire as variáveis de bootstrap do ambiente. O procedimento aceita somente o primeiro administrador; o índice do banco impede criação concorrente de outro. Não existe senha padrão.

Entre no sistema, substitua a senha temporária por uma senha pessoal e configure um aplicativo autenticador. Guarde os códigos de recuperação em local privado. Sem trocar a senha e confirmar TOTP o administrador não acessa municípios nem a operação. Crie o município e seu primeiro gestor em **Municípios → Abrir → Equipe**. Entregue a senha temporária do gestor por canal privado; a troca é obrigatória no primeiro acesso. Gestores podem criar os demais gestores e coletores de sua cidade.

## Publicação na main

Mantenha a integração GitHub → Vercel no repositório `matheus-sperling/ReciclaProjeto`, branch de produção `main`, preset Vite, Node 24. `vercel.json` define build, funções, rotas e cabeçalhos. As migrações não são executadas automaticamente pelo build: aplique-as uma vez com a credencial protegida antes de publicar o código correspondente.

1. Configure banco/roles/variáveis e crie o administrador.
2. Execute as verificações automatizadas em banco descartável; confirme GitHub Actions verde.
3. Confira a implantação Vercel da `main` e execute o roteiro de dois municípios.
4. Valide câmera em celular real via HTTPS e fila offline com reconexão.
5. Depois da nova persistência validada, remova variáveis e integração Blob do projeto Vercel. Não há mais código que dependa do Blob.

## Backups e restauração

Defina a janela de recuperação do Neon conforme a operação e confirme que ela está ativa. Os recursos e limites variam com o plano; consulte o painel e a [documentação de recuperação do Neon](https://neon.com/docs/manage/backup-restore). Faça dumps regulares por `pg_dump` em armazenamento privado e cifrado, com retenção definida; nunca no GitHub. Teste restauração periodicamente em uma branch Neon isolada antes de trocar a aplicação.

Em um incidente, interrompa gravações, restaure numa branch separada e verifique quantidades, recibos, vínculos e políticas com a credencial operacional. Só então altere as conexões e publique novamente. Preserve UUIDs de entregas para que reenvios da fila continuem idempotentes. Nunca apague o banco operacional para tentar corrigir uma implantação.

Para regressão de código, use a função de rollback da Vercel ou reverta o commit na `main`. Um rollback de interface não reverte o esquema. O código anterior baseado em Blob é incompatível com a nova persistência: não o promova contra esse banco. Guarde o último deployment compatível depois da ativação.

## Recuperação do administrador

Use primeiro um código de recuperação no login. Se senha e autenticador forem perdidos, uma pessoa autorizada com a credencial proprietária pode executar `npm run admin:recover`, definindo `DIRECT_URL`, uma nova `ADMIN_PASSWORD` e `ADMIN_RECOVERY_CONFIRM=RECUPERAR_ADMINISTRADOR` no terminal protegido. Isso revoga sessões, retira o autenticador antigo, registra auditoria e exige troca de senha e novo TOTP antes da operação. Limpe as variáveis após executar. O procedimento não existe como endpoint público.

## Pontos de coleta e mapa municipal

Gestores e administradores podem cadastrar, editar, desativar e **excluir pontos** em **Pontos de coleta**. O administrador deve abrir o município antes de administrar seus cadastros. No cadastro, informe nome e endereço/referência e clique no mapa para selecionar o local. Outro clique move a marcação; a edição começa na localização já salva. A operação por teclado usa setas e Enter, ou o botão **Marcar no centro do mapa**.

O mapa de cadastro e o painel abrem na sede do município. `shared/municipios.ts` contém apenas as 79 sedes de MS, extraídas dos campos `CD_MUN`, `NM_MUN`, `LAT_LOCALIDADE` e `LONG_LOCALIDADE`, com filtros `SIGLA_UF=MS`, `CT_LOCALIDADE=Cidade` e `SCT_LOCALIDADE=Sede Municipal`, do [IBGE — Localidades do Brasil 2022](https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/localidades/Localidades_do_Brasil/2022/Localidades_Brasil_gpkg.zip) (publicado em novembro de 2025, consultado em 01/10/2026). Coordenadas SIRGAS 2000, arredondadas a seis casas. Não há geocodificação externa de moradores ou de endereços. Para atualizar, obtenha a versão oficial, confira unicidade dos códigos e nomes, e substitua somente o recorte de sedes; não versione o arquivo nacional. Novos municípios são selecionados desse catálogo, validado também no servidor. Registros anteriores com nomes inválidos devem ser corrigidos pelo administrador; o identificador municipal e os vínculos são preservados.

A exclusão é permanente na interface: retira o ponto das listas, do mapa e do catálogo de novas coletas. O banco conserva um registro com `deletedAt` e `ativo=false` para manter os vínculos, recibos e indicadores históricos. A API não permite reativar um ponto excluído; se necessário, cadastre um novo ponto. Exclusão, edição e confirmação de entregas são serializadas por ponto, e a versão impede alterações concorrentes silenciosas. Reenvios de entregas já confirmadas continuam retornando o mesmo recibo. Pendências ainda não recebidas para um ponto excluído são rejeitadas, permanecem na fila e podem ser exportadas para conferência.

O administrador pode **excluir contas de gestores e coletores** em **Municípios → Abrir → Equipe → Excluir conta**. A conta desaparece da listagem e suas sessões são revogadas imediatamente; entregas e auditoria permanecem. As proteções da própria conta e do último gestor ativo do município continuam obrigatórias.

## Coletor e suporte

Abra **Coletor** conectado e aguarde “Pronto para coleta offline”. Essa indicação depende de catálogo disponível e confirmação de todos os arquivos públicos no service worker. O mapa remoto não fica disponível offline. APIs e respostas com dados pessoais nunca entram no cache do service worker.

O catálogo municipal e a fila temporária ficam no navegador, separados por conta e município, sem senhas ou tokens. Use dispositivos protegidos. Ao sair, os dados exibidos e o catálogo são apagados; pendências ficam preservadas para a conta original. Não limpe o armazenamento do navegador antes de sincronizar ou exportar pendências. Liberação de espaço, corrupção de armazenamento, rejeições e sessão expirada mantêm registros na fila. Alterações de permissão são reconhecidas ao reconectar. Sincronização exige aplicativo aberto.

Administradores podem desativar cidades e consultar seu histórico. Gestores podem desativar/remover contas; sessões são revogadas e vínculos históricos preservados. A remoção da própria conta e do último gestor ativo é bloqueada, inclusive sob concorrência.

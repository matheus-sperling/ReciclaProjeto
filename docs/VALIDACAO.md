# Roteiro de validação e aceitação

Use um ambiente de teste separado. Dados demonstrativos são criados apenas por `test:setup`, que exige PostgreSQL local descartável `recicla_test`. A produção começa vazia.

1. Acesse como gestor A, cadastre morador, edite nome/bairro e baixe o QR. Confirme formato `recicla:morador:UUID` sem nome ou dados pessoais.
2. Crie gestor e coletor na equipe A, confira senha temporária e troca obrigatória. Edite, desative, reative, redefina senha e remova uma conta. Tente remover a própria conta e o último gestor.
3. Acesse como coletor A, prepare offline, leia QR por câmera, imagem e código manual. Confira morador, ponto ativo, material e peso. Revise antes de confirmar.
4. Desconecte, recarregue `/coletor`, registre entrega e feche/reabra. Reconecte com a mesma conta, sincronize, veja recibo e exporte histórico. Reenvie o mesmo UUID: há apenas uma entrega no painel.
5. Teste sessão expirada, fila preservada após logout/troca de conta, cadastros inativos, QR B em A, peso zero/negativo e armazenamento cheio. Pendências não podem ser enviadas por outra conta.
6. No gestor A, consulte painel por período, mapa, distribuição de materiais e entregas recebidas. Tente acessar/exportar dados B por chamadas diretas; o servidor bloqueia.
7. Como administrador, configure TOTP, selecione cada cidade, administre equipe e teste desativação/reativação municipal. Conta municipal não opera em cidade inativa; administrador consulta o histórico.
8. Confira login, primeiro acesso, segurança, municípios, painel, moradores, equipe, pontos, entregas, coletor, revisão e pendências em computador e celular, claro e escuro. Teste teclado, foco, estados vazios, carregamento e erro.
9. Atualize o aplicativo com entrega no formulário: atualização deve aguardar estado seguro. Verifique que o cache não contém `/api/`.

GitHub Actions executa testes reais de RLS, sessões, TOTP, concorrência e fluxo de navegador. Permissão física da câmera e condições de um celular real em HTTPS exigem validação no aparelho; emulação não substitui essa etapa.

A suíte de navegador cobre as páginas públicas, municipais e administrativas em 320, 360, 390 e 430 pixels de largura, na vertical e nos temas claro e escuro, além de 1440 pixels no computador. No celular, verifica rolagem horizontal da página, das listas e dos diálogos, controles fora da tela, altura mínima de 44 pixels para toque e campos com fonte de pelo menos 16 pixels. Exercita também menu em tela baixa, foco e fechamento por Escape, retorno ao topo na navegação, cadastros, QR, redefinição de acesso, primeiro acesso com autenticador, nomes/e-mails longos, recibos, 128 pendências e revisão da coleta com altura disponível reduzida. Os dados longos são simulados apenas no navegador de teste; os fluxos de persistência, autenticação e sincronização continuam usando PostgreSQL real.

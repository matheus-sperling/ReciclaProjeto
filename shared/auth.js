window.ReciclaAuth = {
  emits: ['authenticated'],
  template: `<section class="access-card" aria-labelledby="access-title">
    <a href="/" class="access-brand">Recicla<span>+</span></a>
    <h1 id="access-title">{{ setup ? 'Configure o primeiro gestor' : 'Acesse sua conta' }}</h1>
    <p>Coleta seletiva de municípios de Mato Grosso do Sul.</p>
    <p v-if="error" class="access-error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">Verificando configuração…</p>
    <form v-if="!loading && configured" @submit.prevent="submit">
      <template v-if="setup"><label>Nome<input v-model="nome" required minlength="2" maxlength="120" autocomplete="name"></label>
        <label>Município<input v-model="municipio" required maxlength="80"></label>
        <label>Código de configuração<input v-model="setupToken" type="password" required autocomplete="off"></label></template>
      <label>E-mail<input v-model="email" type="email" required autocomplete="username"></label>
      <label>Senha<input v-model="password" type="password" required :minlength="setup ? 12 : 1" maxlength="128" :autocomplete="setup ? 'new-password' : 'current-password'"></label>
      <p v-if="setup" class="access-hint">Use uma senha de pelo menos 12 caracteres.</p>
      <button :disabled="busy" type="submit">{{ busy ? 'Aguarde…' : setup ? 'Criar gestor e entrar' : 'Entrar' }}</button>
    </form>
    <p v-if="!loading && !configured">O armazenamento central precisa ser ligado ao projeto na Vercel.</p>
    <p class="access-hint" v-if="!setup && configured">Coletores recebem uma conta criada pelo gestor.</p>
  </section>`,
  setup(_, { emit }) {
    const { ref, onMounted } = Vue;
    const loading = ref(true), configured = ref(false), setup = ref(false), busy = ref(false), error = ref('');
    const nome = ref(''), municipio = ref('Coxim'), email = ref(''), password = ref(''), setupToken = ref('');
    onMounted(async () => {
      try { const status = await ReciclaAPI.request('status'); configured.value = status.configured; setup.value = status.setupNeeded;
        if (!status.configured) error.value = `Configuração pendente: ${(status.missing || []).join(', ')}.`;
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    });
    const submit = async () => {
      if (busy.value) return;
      busy.value = true; error.value = '';
      try {
        const result = await ReciclaAPI.request(setup.value ? 'setup' : 'login', { method: 'POST', body: {
          nome: nome.value, municipio: municipio.value, email: email.value, password: password.value, setupToken: setupToken.value } });
        ReciclaAPI.cacheUser(result.user); password.value = ''; setupToken.value = ''; emit('authenticated', result.user);
      } catch (e) { error.value = e.message; }
      finally { busy.value = false; }
    };
    return { loading, configured, setup, busy, error, nome, municipio, email, password, setupToken, submit };
  }
};

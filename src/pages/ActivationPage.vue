<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Leaf,
  ShieldCheck,
} from "lucide-vue-next";
import { activationRequest, type ActivationStatus } from "../lib/activation";
import { ApiError } from "../lib/api";
const status = ref<ActivationStatus | null>(null),
  checking = ref(true),
  busy = ref(false),
  error = ref(""),
  success = ref(false),
  name = ref(""),
  email = ref(""),
  code = ref(""),
  password = ref(""),
  confirmation = ref("");
function clearSecrets() {
  code.value = "";
  password.value = "";
  confirmation.value = "";
}
onBeforeUnmount(clearSecrets);
async function check() {
  checking.value = true;
  error.value = "";
  try {
    status.value = await activationRequest<ActivationStatus>("status");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Servidor indisponível.";
  } finally {
    checking.value = false;
  }
}
onMounted(check);
async function submit() {
  if (busy.value || !status.value?.available) return;
  error.value = "";
  if (password.value !== confirmation.value) {
    error.value = "As senhas não coincidem. Confira a confirmação.";
    return;
  }
  busy.value = true;
  try {
    await activationRequest("create", {
      code: code.value.trim(),
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    });
    clearSecrets();
    success.value = true;
    status.value = { available: false, reason: "completed" };
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Não foi possível criar sua conta.";
    if (e instanceof ApiError && e.code === "SETUP_CLOSED") {
      clearSecrets();
      status.value = { available: false, reason: "completed" };
    }
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="activation-layout">
    <RouterLink to="/entrar" class="brand"
      ><span class="brand-icon"><Leaf :size="25" /></span
      ><span
        >Recicla<span class="brand-plus">+</span
        ><small>COLETA QUE TRANSFORMA</small></span
      ></RouterLink
    >
    <section class="activation-card" aria-labelledby="activation-title">
      <div class="activation-icon">
        <component :is="success ? CheckCircle2 : ShieldCheck" :size="30" />
      </div>
      <span class="eyebrow">PRIMEIRO ACESSO</span>
      <h1 id="activation-title">
        {{ success ? "Sua conta foi criada" : "Ative seu Recicla+" }}
      </h1>
      <p class="lead">
        {{
          success
            ? "Entre com o e-mail e a senha que você acabou de cadastrar para concluir a proteção da sua conta."
            : "Crie o administrador responsável pela plataforma e comece a organizar seus municípios."
        }}
      </p>
      <p v-if="checking" class="alert" role="status">
        Verificando a disponibilidade da ativação…
      </p>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <template v-if="success">
        <p class="alert success" role="status">
          Ativação concluída. Esta página não poderá criar outras contas.
        </p>
        <ol class="activation-steps">
          <li>Entre com sua nova conta.</li>
          <li>Troque a senha inicial por uma senha pessoal.</li>
          <li>
            Configure o aplicativo autenticador e guarde os códigos de
            recuperação.
          </li>
        </ol>
        <RouterLink to="/entrar" class="button primary full"
          >Ir para o login <ArrowRight :size="18"
        /></RouterLink>
      </template>
      <form
        v-else-if="!checking && status?.available"
        class="form-stack"
        @submit.prevent="submit"
      >
        <label for="activation-code"
          >Código de ativação<input
            id="activation-code"
            v-model="code"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="Cole seu código privado"
            maxlength="100"
            required
            aria-describedby="activation-code-help"
        /></label>
        <p id="activation-code-help" class="muted activation-hint">
          Use o código privado fornecido na configuração do projeto.
        </p>
        <label for="activation-name"
          >Seu nome<input
            id="activation-name"
            v-model="name"
            autocomplete="name"
            minlength="2"
            maxlength="120"
            placeholder="Nome completo"
            required
        /></label>
        <label for="activation-email"
          >Seu e-mail<input
            id="activation-email"
            v-model="email"
            type="email"
            autocomplete="username"
            maxlength="254"
            placeholder="voce@exemplo.com"
            required
        /></label>
        <label for="activation-password"
          >Senha inicial<input
            id="activation-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            placeholder="Pelo menos 12 caracteres"
            required
        /></label>
        <label for="activation-confirmation"
          >Confirme a senha<input
            id="activation-confirmation"
            v-model="confirmation"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
        /></label>
        <button class="button primary full" :disabled="busy">
          {{ busy ? "Criando sua conta…" : "Criar meu administrador"
          }}<ArrowRight :size="18" />
        </button>
        <div class="access-help">
          <KeyRound :size="20" />
          <p>
            No primeiro login, você concluirá a troca de senha e a verificação
            em duas etapas.
          </p>
        </div>
      </form>
      <template v-else-if="!checking && status">
        <p class="alert" role="status">
          {{
            status.reason === "completed"
              ? "O administrador já foi criado. Entre com a conta existente."
              : "A ativação está indisponível. O responsável pelo projeto precisa habilitar um código válido."
          }}
        </p>
        <RouterLink to="/entrar" class="button primary full"
          >Ir para o login <ArrowRight :size="18"
        /></RouterLink>
      </template>
      <button v-else-if="!checking" class="button primary full" @click="check">
        Tentar novamente
      </button>
      <RouterLink
        v-if="!success && status?.available"
        to="/entrar"
        class="activation-back"
        >Já tem uma conta? Entrar</RouterLink
      >
    </section>
    <p class="login-footer">Recicla+ · Gestão municipal da coleta seletiva</p>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { ShieldCheck, KeyRound, Download } from "lucide-vue-next";
import QRious from "qrious";
import { authClient, authError, request, session, state } from "../lib/api";
import { downloadJson } from "../lib/offline";
const router = useRouter(),
  current = ref(""),
  password = ref(""),
  repeat = ref(""),
  factorPassword = ref(""),
  code = ref(""),
  uri = ref(""),
  codes = ref<string[]>([]),
  qr = ref<HTMLCanvasElement>(),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const required = computed(() => state.user?.role === "administrador"),
  pending = computed(
    () =>
      state.user?.mustChangePassword ||
      (required.value && !state.user?.twoFactorEnabled),
  );
async function change() {
  error.value = "";
  if (password.value !== repeat.value) {
    error.value = "As novas senhas precisam ser iguais.";
    return;
  }
  busy.value = true;
  try {
    await request("trocarSenha", {
      method: "POST",
      scope: false,
      body: { senhaAtual: current.value, novaSenha: password.value },
    });
    current.value = "";
    password.value = "";
    repeat.value = "";
    await session();
    notice.value = "Senha alterada. As outras sessões foram encerradas.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function enable() {
  busy.value = true;
  error.value = "";
  try {
    const result = await authClient.twoFactor.enable({
      password: factorPassword.value,
    });
    if (result.error) throw new Error(authError(result.error));
    if (result.data.method !== "totp")
      throw new Error("Método de autenticação indisponível.");
    uri.value = result.data.totpURI;
    codes.value = result.data.backupCodes;
    await nextTick();
    new QRious({ element: qr.value!, value: uri.value, size: 240, level: "M" });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function verify() {
  busy.value = true;
  error.value = "";
  try {
    const result = await authClient.twoFactor.verifyTotp({
      code: code.value,
      trustDevice: false,
    });
    if (result.error) throw new Error(authError(result.error));
    await session();
    uri.value = "";
    factorPassword.value = "";
    code.value = "";
    notice.value = "Verificação em duas etapas ativada.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function disable() {
  busy.value = true;
  error.value = "";
  try {
    const result = await authClient.twoFactor.disable({
      password: factorPassword.value,
    });
    if (result.error) throw new Error(authError(result.error));
    await session();
    factorPassword.value = "";
    notice.value = "Verificação em duas etapas desativada.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function finish() {
  router.push(
    state.user?.role === "administrador"
      ? "/municipios"
      : state.user?.role === "coletor"
        ? "/coletor"
        : "/painel",
  );
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="breadcrumb-label">SEU ACESSO</div>
      <h1>{{ pending ? "Prepare seu acesso" : "Segurança da conta" }}</h1>
      <p>Proteja sua conta e mantenha seu acesso atualizado.</p>
    </div>
    <button v-if="!pending" class="button primary" @click="finish">
      Continuar para o sistema
    </button>
  </div>
  <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  <p v-if="notice" class="alert" role="status">{{ notice }}</p>
  <p v-if="state.user?.mustChangePassword" class="alert warning">
    Antes de continuar, substitua sua senha temporária por uma senha pessoal.
  </p>
  <div class="security-grid">
    <section class="card security-card">
      <KeyRound />
      <h2>Trocar senha</h2>
      <p>
        Use pelo menos 12 caracteres. Uma frase longa e exclusiva ajuda a
        proteger seu acesso.
      </p>
      <form class="form-stack" @submit.prevent="change">
        <label
          >Senha atual<input
            v-model="current"
            type="password"
            required
            autocomplete="current-password"
            maxlength="128" /></label
        ><label
          >Nova senha<input
            v-model="password"
            type="password"
            required
            minlength="12"
            maxlength="128"
            autocomplete="new-password" /></label
        ><label
          >Repita a nova senha<input
            v-model="repeat"
            type="password"
            required
            minlength="12"
            maxlength="128"
            autocomplete="new-password" /></label
        ><button class="button primary" :disabled="busy">
          {{ busy ? "Aguarde…" : "Salvar nova senha" }}
        </button>
      </form>
    </section>
    <section class="card security-card">
      <ShieldCheck />
      <h2>Verificação em duas etapas</h2>
      <p>
        {{
          required
            ? "Obrigatória para o administrador da plataforma."
            : "Uma proteção adicional opcional para sua conta."
        }}
        Use um aplicativo autenticador e guarde os códigos de recuperação.
      </p>
      <span
        class="badge"
        :class="state.user?.twoFactorEnabled ? 'green' : 'amber'"
        >{{
          state.user?.twoFactorEnabled ? "Proteção ativa" : "Ainda não ativada"
        }}</span
      >
      <p v-if="state.user?.mustChangePassword" class="hint">
        Altere a senha temporária antes de configurar o autenticador.
      </p>
      <template v-else-if="uri"
        ><div class="qr-panel">
          <canvas ref="qr" aria-label="QR para configurar o autenticador" />
        </div>
        <form class="form-stack" @submit.prevent="verify">
          <label
            >Código do aplicativo<input
              v-model="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              required
              pattern="[0-9]{6}"
              maxlength="6" /></label
          ><button class="button primary" :disabled="busy">
            Confirmar e ativar
          </button>
        </form></template
      >
      <form
        v-else-if="!state.user?.twoFactorEnabled || !required"
        class="form-stack"
        @submit.prevent="state.user?.twoFactorEnabled ? disable() : enable()"
      >
        <label
          >Confirme sua senha<input
            v-model="factorPassword"
            type="password"
            required
            autocomplete="current-password"
            maxlength="128" /></label
        ><button
          class="button secondary"
          :disabled="busy || state.user?.mustChangePassword"
        >
          {{
            state.user?.twoFactorEnabled
              ? "Desativar proteção"
              : "Configurar autenticador"
          }}
        </button>
      </form>
      <template v-if="codes.length"
        ><p class="hint">
          Guarde estes códigos em um local privado. Cada código pode ser usado
          uma vez.
        </p>
        <div class="backup-codes">
          <span v-for="item in codes" :key="item">{{ item }}</span>
        </div>
        <button
          class="button secondary"
          @click="
            downloadJson(
              { conta: state.user?.email, codigos: codes },
              'recicla-codigos-recuperacao.json',
            )
          "
        >
          <Download :size="15" />Guardar códigos
        </button></template
      >
    </section>
  </div>
  <p class="hint" style="margin-top: 20px">
    Esqueceu a senha? Solicite uma redefinição ao gestor do seu município. Para
    perda do autenticador, use um código de recuperação no login. O acesso da
    plataforma possui um procedimento de recuperação protegido no servidor.
  </p>
</template>

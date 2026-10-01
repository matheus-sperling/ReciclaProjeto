<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowRight,
  Leaf,
  ShieldCheck,
  Building2,
  Eye,
  EyeOff,
  ArrowLeft,
  KeyRound,
} from "lucide-vue-next";
import { authClient, authError, request, session, state } from "../lib/api";
const email = ref(""),
  password = ref(""),
  code = ref(""),
  error = ref(""),
  busy = ref(false),
  showPassword = ref(false),
  factor = ref(false),
  recovery = ref(false),
  configured = ref(true),
  checking = ref(true);
const router = useRouter(),
  route = useRoute();
onMounted(async () => {
  try {
    configured.value = (
      await request<{ configured: boolean }>("status", { scope: false })
    ).configured;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Servidor indisponível.";
  } finally {
    checking.value = false;
  }
});
async function finish() {
  const u = await session();
  password.value = "";
  code.value = "";
  const redirect =
    typeof route.query.redirect === "string" &&
    /^\/(painel|moradores|equipe|pontos|entregas|coletor|seguranca|municipios)$/.test(
      route.query.redirect,
    )
      ? route.query.redirect
      : "/";
  await router.push(
    u.mustChangePassword || (u.role === "administrador" && !u.twoFactorEnabled)
      ? "/seguranca"
      : redirect,
  );
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (factor.value) {
      const result = recovery.value
        ? await authClient.twoFactor.verifyBackupCode({
            code: code.value,
            trustDevice: false,
          })
        : await authClient.twoFactor.verifyTotp({
            code: code.value,
            trustDevice: false,
          });
      if (result.error) throw new Error(authError(result.error));
      await finish();
    } else {
      const result = await authClient.signIn.email({
        email: email.value.trim(),
        password: password.value,
      });
      if (result.error) throw new Error(authError(result.error));
      if ((result.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
        factor.value = true;
        password.value = "";
      } else await finish();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Não foi possível entrar.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="login-layout">
    <section class="login-story">
      <a href="/" class="brand light-brand"
        ><span class="brand-icon"><Leaf :size="25" /></span
        ><span
          >Recicla<span class="brand-plus">+</span
          ><small>COLETA QUE TRANSFORMA</small></span
        ></a
      >
      <div class="story-copy">
        <span class="story-tag"
          ><span class="status-dot" /> FEITO PARA A SUA CIDADE</span
        >
        <h1>Pequenas entregas.<br /><span>Grandes mudanças.</span></h1>
        <p>
          Uma gestão mais próxima, uma coleta mais organizada e um futuro melhor
          para cada município.
        </p>
        <div class="story-features">
          <div>
            <Building2 :size="22" /><span
              >Seu município,<br /><strong
                >seu espaço de trabalho.</strong
              ></span
            >
          </div>
          <div>
            <ShieldCheck :size="22" /><span
              >Acesso protegido,<br /><strong
                >informações sob controle.</strong
              ></span
            >
          </div>
        </div>
      </div>
      <div class="story-art" aria-hidden="true">
        <div class="art-ring ring-1" />
        <div class="art-ring ring-2" />
        <div class="art-ring ring-3" />
        <Leaf :size="158" :stroke-width="1" />
      </div>
      <footer>Um ciclo melhor começa com a gente.</footer>
    </section>
    <section class="login-form-section">
      <div class="login-form-wrap">
        <span class="eyebrow">BEM-VINDO AO RECICLA+</span>
        <h2>{{ factor ? "Confirme seu acesso" : "Entre no seu espaço" }}</h2>
        <p class="lead">
          {{
            factor
              ? "Uma etapa a mais para proteger sua conta."
              : "Acesse sua conta para acompanhar ou registrar a coleta seletiva."
          }}
        </p>
        <p v-if="checking" class="alert" role="status">
          Verificando o ambiente…
        </p>
        <p v-if="!configured && !checking" class="alert warning">
          O ambiente está em configuração. Peça ao administrador para concluir a
          ativação.
        </p>
        <p v-if="error" class="alert error" role="alert">{{ error }}</p>
        <form @submit.prevent="submit" class="form-stack">
          <template v-if="!factor"
            ><label for="email"
              >E-mail<input
                id="email"
                v-model="email"
                type="email"
                placeholder="voce@municipio.gov.br"
                autocomplete="username"
                required
                maxlength="254" /></label
            ><label for="password"
              >Senha
              <div class="password-field">
                <input
                  id="password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Sua senha de acesso"
                  autocomplete="current-password"
                  required
                  maxlength="128"
                /><button
                  type="button"
                  class="icon-button"
                  :aria-label="showPassword ? 'Ocultar senha' : 'Mostrar senha'"
                  @click="showPassword = !showPassword"
                >
                  <component :is="showPassword ? EyeOff : Eye" :size="19" />
                </button></div></label
          ></template>
          <label v-else for="factor-code"
            >{{
              recovery
                ? "Código de recuperação"
                : "Código do aplicativo autenticador"
            }}<input
              id="factor-code"
              v-model="code"
              :inputmode="recovery ? 'text' : 'numeric'"
              :maxlength="recovery ? 64 : 6"
              autocomplete="one-time-code"
              placeholder="000000"
              required
          /></label>
          <button
            class="button primary full"
            :disabled="busy || checking || !configured"
          >
            {{ busy ? "Verificando…" : factor ? "Confirmar acesso" : "Entrar"
            }}<ArrowRight :size="18" />
          </button>
          <button
            v-if="factor"
            class="text-button"
            type="button"
            @click="
              recovery = !recovery;
              code = '';
            "
          >
            {{
              recovery
                ? "Usar aplicativo autenticador"
                : "Usar código de recuperação"
            }}
          </button>
          <button
            v-if="factor"
            type="button"
            class="text-button"
            @click="
              factor = false;
              code = '';
            "
          >
            Voltar ao login
          </button>
        </form>
        <div class="access-help">
          <KeyRound :size="19" />
          <p>
            Precisa de acesso ou esqueceu a senha?<br /><strong
              >Procure o gestor responsável pelo seu município.</strong
            >
          </p>
        </div>
        <p class="login-footer">
          Recicla+ · Gestão municipal da coleta seletiva
        </p>
      </div>
    </section>
  </main>
</template>

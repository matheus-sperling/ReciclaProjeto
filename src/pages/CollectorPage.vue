<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import {
  Leaf,
  ScanLine,
  Camera,
  ImagePlus,
  Keyboard,
  RefreshCw,
  Download,
  LogOut,
  ShieldCheck,
  ArrowLeft,
  CheckCircle2,
} from "lucide-vue-next";
import { Html5Qrcode } from "html5-qrcode";
import type { Catalogo, Entrega, Morador } from "../../shared/contracts";
import { lerQr, pesoGramas, uuid } from "../../shared/validation";
import {
  authClient,
  authError,
  clearContext,
  request,
  session,
  state,
  number,
  dateTime,
} from "../lib/api";
import {
  cacheCollector,
  downloadJson,
  enqueue,
  history,
  logoutOffline,
  pending,
  readLocal,
  synchronize,
} from "../lib/offline";
import UiDialog from "../components/UiDialog.vue";
import PageState from "../components/PageState.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
const router = useRouter(),
  user = state.user!;
const catalog = ref<Catalogo | null>(null),
  error = ref(""),
  notice = ref(""),
  loading = ref(true),
  syncing = ref(false),
  saving = ref(false),
  online = ref(navigator.onLine),
  offlineReady = ref(false),
  camera = ref(false),
  cameraStarting = ref(false),
  manual = ref(""),
  resident = ref<Morador | null>(null),
  point = ref(""),
  material = ref(""),
  weight = ref(""),
  review = ref<Entrega | null>(null),
  rows = ref<Entrega[]>([]),
  remoteRows = ref<Entrega[]>([]),
  tab = ref<"nova" | "historico" | "pendencias">("nova"),
  showManual = ref(false),
  exit = ref(false),
  update = ref(false);
let scanner: Html5Qrcode | undefined,
  registration: ServiceWorkerRegistration | undefined,
  installingWorker: ServiceWorker | undefined,
  timer: ReturnType<typeof setInterval>;
const queue = computed(() => rows.value.filter((r) => r.status === "pendente")),
  visible = computed(() =>
    tab.value === "pendencias" ? queue.value : rows.value,
  ),
  dirty = computed(
    () =>
      !!resident.value ||
      !!weight.value ||
      !!manual.value ||
      !!review.value ||
      camera.value ||
      cameraStarting.value,
  );
function local() {
  try {
    const merged = new Map(
      [...remoteRows.value, ...history(user)].map((r) => [r.id, r]),
    );
    rows.value = [...merged.values()].sort((a, b) =>
      b.criadoEm.localeCompare(a.criadoEm),
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function remoteHistory() {
  error.value = "";
  loading.value = true;
  try {
    const all: Entrega[] = [],
      snapshot = new Date().toISOString();
    for (let page = 1; ; page++) {
      const result = await request<{ entregas: Entrega[]; total: number }>(
        "entregas",
        { query: { page, snapshot } },
      );
      all.push(...result.entregas);
      if (all.length >= result.total) break;
    }
    remoteRows.value = all;
    local();
    notice.value =
      "Histórico completo consultado. A exportação inclui os registros exibidos.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function stop() {
  if (scanner?.isScanning)
    try {
      await scanner.stop();
    } catch {}
  camera.value = false;
}
async function identify(text: string) {
  try {
    const id = text.startsWith("recicla:")
      ? lerQr(text)
      : uuid.parse(text.trim());
    const row = catalog.value?.moradores.find((m) => m.id === id && m.ativo);
    if (!row)
      throw new Error(
        "Morador indisponível neste município. Atualize o catálogo ou confira o QR.",
      );
    resident.value = row;
    manual.value = "";
    showManual.value = false;
    error.value = "";
    await stop();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function startCamera() {
  if (camera.value || cameraStarting.value) return;
  error.value = "";
  if (!window.isSecureContext) {
    error.value =
      "A câmera exige uma conexão segura. Abra o aplicativo por HTTPS; um endereço HTTP da rede local não permite usar a câmera.";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value =
      "Este navegador não oferece acesso à câmera. Abra o aplicativo no Chrome ou Safari, ou use uma imagem ou o código manual.";
    return;
  }
  cameraStarting.value = true;
  await nextTick();
  try {
    scanner ??= new Html5Qrcode("recicla-scanner");
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 8,
        qrbox: (width, height) => {
          const size = Math.min(220, Math.floor(Math.min(width, height) * 0.7));
          return { width: size, height: size };
        },
      },
      (text) => {
        void identify(text);
      },
      () => {},
    );
    camera.value = true;
  } catch (e) {
    const reason = String(e);
    error.value = /NotAllowedError|PermissionDeniedError/i.test(reason)
      ? "O acesso à câmera foi bloqueado. Autorize a câmera nas configurações deste site e tente novamente."
      : /NotFoundError|DevicesNotFoundError/i.test(reason)
        ? "Nenhuma câmera foi encontrada. Use uma imagem ou o código manual."
        : "Não foi possível abrir a câmera. Feche outros aplicativos que estejam usando a câmera e tente novamente, ou use uma imagem ou o código manual.";
  } finally {
    cameraStarting.value = false;
  }
}
async function image(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  error.value = "";
  try {
    await stop();
    scanner ??= new Html5Qrcode("recicla-scanner");
    await identify(await scanner.scanFile(file, false));
  } catch {
    error.value =
      "Não encontramos um QR válido nesta imagem. Tente uma foto mais nítida.";
  } finally {
    input.value = "";
  }
}
function prepare() {
  error.value = "";
  try {
    if (!catalog.value || !resident.value)
      throw new Error("Leia o QR ou informe o código do morador.");
    const p = catalog.value.pontos.find((p) => p.id === point.value && p.ativo),
      m = catalog.value.materiais.find((m) => m.id === material.value);
    if (!p || !m) throw new Error("Selecione o ponto e o material.");
    const kg = pesoGramas(weight.value) / 1000;
    review.value = {
      id: crypto.randomUUID(),
      municipioId: user.municipioId!,
      coletorId: user.id,
      moradorId: resident.value.id,
      pontoId: p.id,
      materialId: m.id,
      kg,
      criadoEm: new Date().toISOString(),
      moradorNome: resident.value.nome,
      coletorNome: user.nome,
      pontoNome: p.nome,
      materialNome: m.nome,
      status: "pendente",
    };
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function confirm() {
  if (!review.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await enqueue(user, review.value);
    review.value = null;
    resident.value = null;
    weight.value = "";
    manual.value = "";
    notice.value =
      "Entrega salva neste dispositivo. O recibo será gerado após a sincronização.";
    local();
    if (online.value) await sync();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function checkOffline() {
  offlineReady.value = false;
  if (!registration?.active || !catalog.value) return;
  const channel = new MessageChannel();
  const ready = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timeout);
      resolve(e.data.ready === true);
    };
    registration!.active!.postMessage({ type: "CHECK_OFFLINE" }, [
      channel.port2,
    ]);
  });
  channel.port1.close();
  offlineReady.value = ready;
}
async function refresh() {
  error.value = "";
  try {
    const current = await session();
    if (current.id !== user.id || current.municipioId !== user.municipioId)
      throw new Error("A conta mudou. Entre novamente antes de enviar.");
    const data = await request<Catalogo>("catalogo");
    cacheCollector(user, data);
    catalog.value = data;
    if (!data.pontos.some((p) => p.id === point.value && p.ativo))
      point.value = "";
    await checkOffline();
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) {
      catalog.value = null;
      localStorage.removeItem(
        `recicla-v3:${user.municipioId}:${user.id}:catalog`,
      );
      state.user = null;
      clearContext();
      await stop();
      await router.replace({
        path: "/entrar",
        query: { redirect: "/coletor" },
      });
    } else if (!catalog.value || (e as { status?: number }).status !== 0)
      error.value = (e as Error).message;
  }
}
async function sync() {
  if (syncing.value || !online.value) return;
  syncing.value = true;
  error.value = "";
  try {
    await refresh();
    if (!state.user || !catalog.value) return;
    await synchronize(user);
    local();
    notice.value = queue.value.length
      ? "Algumas entregas precisam de atenção. Veja as pendências."
      : "Entregas sincronizadas. Os recibos estão no histórico.";
  } catch (e) {
    error.value = (e as Error).message;
    if ([401, 403].includes((e as { status: number }).status)) {
      await stop();
      router.replace({ path: "/entrar", query: { redirect: "/coletor" } });
    }
  } finally {
    syncing.value = false;
    local();
  }
}
function connectivity() {
  online.value = navigator.onLine;
  if (online.value) {
    void sync();
  } else void checkOffline();
}
async function logout() {
  saving.value = true;
  try {
    const result = await authClient.signOut();
    if (result.error) throw new Error(authError(result.error));
    await stop();
    logoutOffline(user);
    catalog.value = null;
    rows.value = [];
    review.value = null;
    resident.value = null;
    weight.value = "";
    manual.value = "";
    state.user = null;
    clearContext();
    exit.value = false;
    await router.replace("/entrar");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
function installUpdate() {
  if (dirty.value || saving.value || syncing.value) {
    error.value =
      "Salve ou conclua o formulário e feche a câmera antes de atualizar.";
    return;
  }
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}
function controller() {
  if (!dirty.value && !saving.value && !syncing.value) location.reload();
  else update.value = true;
}
function workerState() {
  update.value =
    !!registration?.waiting ||
    (installingWorker?.state === "installed" &&
      !!registration?.active &&
      installingWorker !== registration.active);
  void checkOffline();
}
function observeWorker() {
  installingWorker?.removeEventListener("statechange", workerState);
  installingWorker = registration?.installing || undefined;
  installingWorker?.addEventListener("statechange", workerState);
  workerState();
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onBeforeRouteLeave(() => {
  if (dirty.value && state.user) {
    error.value = "Conclua a entrega antes de sair desta tela.";
    return false;
  }
});
onMounted(async () => {
  try {
    catalog.value = readLocal<Catalogo | null>(user, "catalog", null);
    if (catalog.value?.municipio.id !== user.municipioId) catalog.value = null;
    local();
    if ("serviceWorker" in navigator) {
      registration = await navigator.serviceWorker.register("/coletor-sw.js", {
        scope: "/coletor",
      });
      update.value = !!registration.waiting;
      registration.addEventListener("updatefound", observeWorker);
      observeWorker();
      navigator.serviceWorker.addEventListener("controllerchange", controller);
      navigator.serviceWorker.ready.then(() => checkOffline());
    }
    if (online.value) await refresh();
    else await checkOffline();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
  window.addEventListener("online", connectivity);
  window.addEventListener("offline", connectivity);
  window.addEventListener("recicla-data", local);
  window.addEventListener("storage", local);
  window.addEventListener("beforeunload", beforeUnload);
  timer = setInterval(() => {
    if (online.value && !document.hidden && !dirty.value) void sync();
  }, 30000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  void stop();
  window.removeEventListener("online", connectivity);
  window.removeEventListener("offline", connectivity);
  window.removeEventListener("recicla-data", local);
  window.removeEventListener("storage", local);
  window.removeEventListener("beforeunload", beforeUnload);
  navigator.serviceWorker?.removeEventListener("controllerchange", controller);
  registration?.removeEventListener("updatefound", observeWorker);
  installingWorker?.removeEventListener("statechange", workerState);
});
</script>
<template>
  <div class="collector-layout">
    <header class="collector-topbar">
      <RouterLink class="brand" to="/coletor"
        ><span class="brand-icon"><Leaf :size="21" /></span
        ><span>Recicla<span class="brand-plus">+</span></span></RouterLink
      >
      <div>
        <RouterLink
          v-if="user.role === 'gestor'"
          class="icon-button"
          to="/painel"
          aria-label="Voltar ao painel"
          ><ArrowLeft :size="19" /></RouterLink
        ><RouterLink
          class="icon-button"
          to="/seguranca"
          aria-label="Segurança da conta"
          ><ShieldCheck :size="19" /></RouterLink
        ><ThemeToggle compact /><button
          class="icon-button"
          aria-label="Sair da conta"
          @click="exit = true"
        >
          <LogOut :size="18" />
        </button>
      </div>
    </header>
    <main class="collector-main">
      <div class="collector-intro">
        <div>
          <div class="breadcrumb-label">COLETA SELETIVA</div>
          <h1>Vamos coletar.</h1>
          <p>{{ user.nome }} · {{ user.municipio?.nome }}</p>
          <div class="collector-status">
            <span
              ><span class="status-dot" :class="{ offline: !online }" />{{
                online ? "Conectado" : "Sem conexão"
              }}</span
            ><span>{{
              offlineReady
                ? "Pronto para coleta offline"
                : "Preparação offline pendente"
            }}</span>
          </div>
        </div>
        <ScanLine :size="36" class="detail-icon" />
      </div>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="notice" class="alert" role="status">{{ notice }}</p>
      <p v-if="update" class="alert">
        Uma atualização está disponível.
        <button
          class="text-button"
          :disabled="dirty || saving || syncing"
          @click="installUpdate"
        >
          Atualizar aplicativo
        </button>
      </p>
      <div class="card sync-card">
        <div>
          <strong>{{
            queue.length
              ? `${queue.length} entrega(s) aguardando envio`
              : "Sua fila está em dia"
          }}</strong
          ><small>A sincronização exige o aplicativo aberto.</small>
        </div>
        <button
          class="button secondary small"
          :disabled="syncing || !online || saving"
          @click="sync"
        >
          <RefreshCw :size="14" :class="{ spin: syncing }" />{{
            syncing ? "Enviando…" : "Sincronizar"
          }}
        </button>
      </div>
      <nav class="collector-tabs" aria-label="Área de coleta">
        <button :class="{ active: tab === 'nova' }" @click="tab = 'nova'">
          Nova entrega</button
        ><button
          :class="{ active: tab === 'historico' }"
          :disabled="camera || cameraStarting"
          @click="tab = 'historico'"
        >
          Histórico</button
        ><button
          :class="{ active: tab === 'pendencias' }"
          :disabled="camera || cameraStarting"
          @click="tab = 'pendencias'"
        >
          Pendências<span v-if="queue.length" class="badge amber">{{
            queue.length
          }}</span>
        </button>
      </nav>
      <PageState
        :loading="loading"
        :empty="!loading && !catalog && tab === 'nova'"
        title="Conecte-se para preparar o coletor"
        description="O catálogo precisa ser carregado com sua conta antes da primeira coleta offline."
        @retry="refresh"
      /><template v-if="tab === 'nova' && catalog && !loading"
        ><section class="card collector-card">
          <div class="step-heading">
            <span class="step-number">01</span>
            <div>
              <h2>Identifique o morador</h2>
              <p>Leia o QR para localizar o cadastro municipal.</p>
            </div>
          </div>
          <div v-if="resident" class="selected-resident">
            <CheckCircle2 :size="24" />
            <div>
              <strong>{{ resident.nome }}</strong
              ><small>{{ resident.bairro || "Morador cadastrado" }}</small>
            </div>
            <button
              class="text-button"
              style="margin-left: auto"
              @click="resident = null"
            >
              Trocar
            </button>
          </div>
          <div v-if="!resident && !camera" class="scanner-placeholder">
            <ScanLine :size="47" :stroke-width="1.3" /><span
              >Posicione o QR do morador diante da câmera.</span
            >
          </div>
          <div id="recicla-scanner" class="scanner-region" />
          <div v-if="!resident" class="scan-actions">
            <button
              class="button primary"
              :disabled="cameraStarting"
              @click="camera ? stop() : startCamera()"
            >
              <Camera :size="17" />{{
                cameraStarting
                  ? "Abrindo câmera…"
                  : camera
                    ? "Fechar câmera"
                    : "Ler com a câmera"
              }}</button
            ><label class="button secondary file-input"
              ><ImagePlus :size="17" />Escolher imagem<input
                type="file"
                accept="image/*"
                :disabled="cameraStarting"
                @change="image" /></label
            ><button
              class="button secondary"
              :disabled="cameraStarting"
              @click="showManual = !showManual"
            >
              <Keyboard :size="17" />Código manual
            </button>
          </div>
          <form
            v-if="showManual && !resident"
            class="form-stack"
            style="margin-top: 18px"
            @submit.prevent="identify(manual)"
          >
            <label
              >QR ou identificador do morador<input
                v-model="manual"
                required
                maxlength="70"
                placeholder="recicla:morador:…" /></label
            ><button class="button secondary">Localizar morador</button>
          </form>
        </section>
        <form @submit.prevent="prepare">
          <section class="card collector-card">
            <div class="step-heading">
              <span class="step-number">02</span>
              <div>
                <h2>Informe a entrega</h2>
                <p>Selecione o local, o material e o peso conferido.</p>
              </div>
            </div>
            <div class="form-stack">
              <label
                >Ponto de coleta<select
                  v-model="point"
                  required
                  aria-label="Ponto de coleta"
                >
                  <option value="" disabled>Selecione o ponto</option>
                  <option
                    v-for="p in catalog.pontos.filter((p) => p.ativo)"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.nome }}
                  </option>
                </select></label
              ><label
                >Material<select
                  v-model="material"
                  required
                  aria-label="Material"
                >
                  <option value="" disabled>Selecione o material</option>
                  <option
                    v-for="m in catalog.materiais"
                    :key="m.id"
                    :value="m.id"
                  >
                    {{ m.nome }}
                  </option>
                </select></label
              ><label
                >Peso em quilogramas
                <div class="weight-field">
                  <input
                    v-model="weight"
                    inputmode="decimal"
                    required
                    placeholder="0,000"
                    maxlength="15"
                  /><span>kg</span>
                </div>
                <p class="hint">
                  Aceita até três casas decimais. Exemplo: 2,500 kg.
                </p></label
              >
            </div>
          </section>
          <button class="button primary full" :disabled="saving || !resident">
            Revisar entrega
          </button>
        </form>
        <p class="hint" style="margin-top: 15px">
          Catálogo atualizado em {{ dateTime(catalog.atualizadoEm) }}.
          Alterações de acesso e cadastros são reconhecidas após reconectar.
        </p></template
      ><template v-if="tab !== 'nova'"
        ><div class="history-heading">
          <h2>
            {{
              tab === "pendencias"
                ? "Entregas pendentes"
                : "Seu histórico neste dispositivo"
            }}
          </h2>
          <button
            class="button secondary small"
            @click="
              downloadJson(
                {
                  municipio: user.municipio,
                  coletor: user.nome,
                  entregas: visible,
                },
                'recicla-coleta-' + user.id + '.json',
              )
            "
          >
            <Download :size="14" />Exportar
          </button>
        </div>
        <PageState
          :empty="!visible.length"
          :title="
            tab === 'pendencias'
              ? 'Nenhuma entrega pendente'
              : 'Nenhuma entrega neste dispositivo'
          "
          description="Seus registros aparecerão aqui após confirmar uma coleta."
        />
        <div class="history-list">
          <article v-for="r in visible" :key="r.id" class="card history-record">
            <div class="record-top">
              <strong>{{ r.moradorNome }}</strong
              ><strong>{{ number(r.kg) }} kg</strong>
            </div>
            <p>{{ r.materialNome }} · {{ r.pontoNome }}</p>
            <p class="mono">{{ r.id }}</p>
            <p v-if="r.erroEnvio" class="alert error">
              {{ r.erroEnvio }} A entrega continua preservada.
            </p>
            <div class="record-bottom">
              <span>{{ dateTime(r.criadoEm) }}</span
              ><span
                class="badge"
                :class="r.status === 'pendente' ? 'amber' : 'green'"
                >{{
                  r.status === "pendente"
                    ? "Aguardando recibo"
                    : "Recibo confirmado"
                }}</span
              >
            </div>
          </article>
        </div>
        <button
          v-if="online && tab === 'historico'"
          class="button secondary full"
          style="margin-top: 18px"
          :disabled="loading"
          @click="remoteHistory"
        >
          Consultar histórico completo no servidor
        </button></template
      >
    </main>
    <footer class="collector-footer">
      Recicla+ · Uma entrega por vez, um futuro melhor.
    </footer>
    <UiDialog
      :open="!!review"
      @update:open="!$event && !saving && (review = null)"
      title="Confira antes de confirmar"
      description="A entrega será preservada neste dispositivo até receber um recibo do servidor."
      ><dl class="review-list">
        <div>
          <dt>Morador</dt>
          <dd>{{ review?.moradorNome }}</dd>
        </div>
        <div>
          <dt>Ponto</dt>
          <dd>{{ review?.pontoNome }}</dd>
        </div>
        <div>
          <dt>Material</dt>
          <dd>{{ review?.materialNome }}</dd>
        </div>
        <div>
          <dt>Peso</dt>
          <dd class="review-weight">{{ number(review?.kg || 0) }} kg</dd>
        </div>
      </dl>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button
          class="button secondary"
          :disabled="saving"
          @click="review = null"
        >
          Voltar</button
        ><button class="button primary" :disabled="saving" @click="confirm">
          {{ saving ? "Salvando…" : "Confirmar entrega" }}
        </button>
      </div></UiDialog
    ><UiDialog
      v-model:open="exit"
      title="Sair da conta"
      description="As pendências permanecem neste dispositivo, disponíveis apenas ao entrar novamente com esta conta."
      ><p class="lead">
        {{
          dirty
            ? "Há informações ainda no formulário. Elas serão descartadas ao sair."
            : "O catálogo e os dados exibidos serão limpos ao sair."
        }}
      </p>
      <p v-if="!online" class="alert warning">
        Conecte-se para encerrar sua sessão no servidor.
      </p>
      <div class="form-actions">
        <button class="button secondary" @click="exit = false">
          Continuar coletando</button
        ><button
          class="button primary"
          :disabled="saving || !online"
          @click="logout"
        >
          Sair da conta
        </button>
      </div></UiDialog
    >
  </div>
</template>

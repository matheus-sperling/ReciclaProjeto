<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  Plus,
  Search,
  Pencil,
  QrCode,
  Building2,
  Users,
  MapPin,
  KeyRound,
  Trash2,
  Power,
  ArrowUpRight,
  Download,
} from "lucide-vue-next";
import QRious from "qrious";
import UiDialog from "../components/UiDialog.vue";
import PageState from "../components/PageState.vue";
import Pagination from "../components/Pagination.vue";
import PointLocationPicker, {
  type PointLocation,
} from "../components/PointLocationPicker.vue";
import { municipiosMS } from "../../shared/municipios";
import { request, state, selectMunicipio } from "../lib/api";
import { roleLabel, type Municipio } from "../../shared/contracts";
type Kind = "municipios" | "moradores" | "pontos" | "equipe";
type Row = {
  id: string;
  nome: string;
  ativo: boolean;
  version: number;
  uf?: string;
  bairro?: string;
  local?: string;
  lat?: number;
  lng?: number;
  email?: string;
  role?: "gestor" | "coletor";
};
const props = defineProps<{ kind: Kind }>(),
  router = useRouter();
const titles = {
  municipios: "Municípios",
  moradores: "Moradores e QR",
  pontos: "Pontos de coleta",
  equipe: "Equipe municipal",
};
const singular = {
  municipios: "município",
  moradores: "morador",
  pontos: "ponto de coleta",
  equipe: "integrante",
};
const descriptions = {
  municipios: "Organize as cidades e acompanhe cada operação.",
  moradores:
    "Cadastros atualizados, identificação simples e coleta organizada.",
  pontos: "Organize os locais de entrega e marque cada ponto no mapa.",
  equipe: "Administre gestores e coletores do seu município.",
};
const rows = ref<Row[]>([]),
  page = ref(1),
  total = ref(0),
  search = ref(""),
  loading = ref(false),
  error = ref(""),
  notice = ref(""),
  open = ref(false),
  saving = ref(false),
  formError = ref(""),
  editing = ref<Row | null>(null),
  confirmation = ref<{
    row: Row;
    action: "ativo" | "excluir" | "redefinirSenha";
  } | null>(null),
  temporary = ref(""),
  qrResident = ref<Row | null>(null),
  qrCanvas = ref<HTMLCanvasElement>();
const pointLocation = ref<PointLocation | null>(null);
const form = reactive({
  nome: "",
  bairro: "",
  local: "",
  email: "",
  role: "coletor" as "gestor" | "coletor",
  ativo: true,
  uf: "MS",
});
const scopedReady = computed(
    () => props.kind === "municipios" || !!state.municipio,
  ),
  writable = computed(
    () => props.kind === "municipios" || state.municipio?.ativo,
  );
let loadId = 0,
  timer: ReturnType<typeof setTimeout>;
async function load() {
  const id = ++loadId;
  rows.value = [];
  error.value = "";
  if (!scopedReady.value) return;
  loading.value = true;
  try {
    const result = await request<Record<string, unknown>>(props.kind, {
      query: { page: page.value, search: search.value },
      scope: props.kind !== "municipios",
    });
    if (id === loadId) {
      rows.value = result[
        props.kind === "equipe" ? "users" : props.kind
      ] as Row[];
      total.value = result.total as number;
    }
  } catch (e) {
    if (id === loadId) error.value = (e as Error).message;
  } finally {
    if (id === loadId) loading.value = false;
  }
}
watch(
  () => [props.kind, state.municipio?.id],
  () => {
    search.value = "";
    page.value = 1;
    notice.value = "";
    open.value = false;
    confirmation.value = null;
    temporary.value = "";
    qrResident.value = null;
    load();
  },
  { immediate: true },
);
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});
onBeforeUnmount(() => {
  loadId++;
  clearTimeout(timer);
});
function edit(row: Row | null) {
  editing.value = row;
  formError.value = "";
  pointLocation.value =
    row?.lat !== undefined && row.lng !== undefined
      ? { lat: row.lat, lng: row.lng }
      : null;
  Object.assign(form, {
    nome: row?.nome || "",
    bairro: row?.bairro || "",
    local: row?.local || "",
    email: row?.email || "",
    role: row?.role || "coletor",
    ativo: row?.ativo ?? true,
    uf: "MS",
  });
  open.value = true;
}
function payload() {
  switch (props.kind) {
    case "municipios":
      return { nome: form.nome, uf: "MS", ativo: form.ativo };
    case "moradores":
      return { nome: form.nome, bairro: form.bairro, ativo: form.ativo };
    case "pontos":
      if (!pointLocation.value)
        throw new Error("Selecione a localização do ponto no mapa.");
      return {
        nome: form.nome,
        local: form.local,
        ...pointLocation.value,
        ativo: form.ativo,
      };
    case "equipe":
      return editing.value
        ? { nome: form.nome, role: form.role }
        : { nome: form.nome, email: form.email, role: form.role };
  }
}
async function save() {
  saving.value = true;
  formError.value = "";
  try {
    const body = {
      ...payload(),
      ...(editing.value
        ? {
            id: editing.value.id,
            ...(props.kind !== "equipe"
              ? { version: editing.value.version }
              : {}),
          }
        : {}),
    };
    const result = await request<{
      temporaryPassword?: string;
      municipio?: Municipio;
    }>(props.kind, {
      method: editing.value ? "PATCH" : "POST",
      body,
      scope: props.kind !== "municipios",
    });
    open.value = false;
    temporary.value = result.temporaryPassword || "";
    notice.value = "Cadastro salvo com sucesso.";
    if (result.municipio && result.municipio.id === state.municipio?.id)
      selectMunicipio(result.municipio);
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function confirm() {
  if (!confirmation.value) return;
  saving.value = true;
  formError.value = "";
  const { row, action } = confirmation.value;
  try {
    let body: Record<string, unknown>;
    if (props.kind === "equipe")
      body = { id: row.id, [action]: action === "ativo" ? !row.ativo : true };
    else if (props.kind === "pontos")
      body =
        action === "excluir"
          ? { id: row.id, version: row.version }
          : {
              id: row.id,
              version: row.version,
              nome: row.nome,
              local: row.local,
              lat: row.lat,
              lng: row.lng,
              ativo: !row.ativo,
            };
    else {
      Object.assign(form, row);
      body = {
        ...payload(),
        id: row.id,
        version: row.version,
        ativo: !row.ativo,
      };
    }
    const result = await request<{
      temporaryPassword?: string;
      municipio?: Municipio;
    }>(props.kind, {
      method:
        props.kind === "pontos" && action === "excluir" ? "DELETE" : "PATCH",
      body,
      scope: props.kind !== "municipios",
    });
    temporary.value = result.temporaryPassword || "";
    if (result.municipio && result.municipio.id === state.municipio?.id)
      selectMunicipio(result.municipio);
    confirmation.value = null;
    notice.value =
      action === "excluir"
        ? props.kind === "pontos"
          ? "Ponto de coleta excluído."
          : "Conta excluída. O acesso foi revogado."
        : "Alteração concluída.";
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
function ask(row: Row, action: "ativo" | "excluir" | "redefinirSenha") {
  formError.value = "";
  confirmation.value = { row, action };
}
async function showQr(row: Row) {
  qrResident.value = row;
  await nextTick();
  new QRious({
    element: qrCanvas.value!,
    value: "recicla:morador:" + row.id,
    size: 300,
    level: "H",
  });
}
function downloadQr() {
  if (!qrCanvas.value || !qrResident.value) return;
  const a = document.createElement("a");
  a.href = qrCanvas.value.toDataURL("image/png");
  a.download = "recicla-qr-" + qrResident.value.id + ".png";
  a.click();
}
function choose(row: Row) {
  selectMunicipio(row as Municipio);
  router.push("/painel");
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="breadcrumb-label">
        {{ kind === "municipios" ? "PLATAFORMA" : "GESTÃO MUNICIPAL" }}
      </div>
      <h1>{{ titles[kind] }}</h1>
      <p>{{ descriptions[kind] }}</p>
    </div>
    <button
      v-if="scopedReady"
      class="button primary"
      :disabled="!writable"
      @click="edit(null)"
    >
      <Plus :size="16" />Cadastrar {{ singular[kind] }}
    </button>
  </div>
  <div v-if="!scopedReady" class="card scope-empty">
    <Building2 :size="40" />
    <h2>Escolha um município</h2>
    <p>A seleção define os cadastros e a equipe que você vai administrar.</p>
    <RouterLink class="button primary" to="/municipios"
      >Selecionar município</RouterLink
    >
  </div>
  <template v-else>
    <p v-if="notice" class="alert" role="status">{{ notice }}</p>
    <p v-if="!writable" class="alert warning">
      Município inativo. O histórico está disponível para consulta; reative a
      cidade para alterar cadastros.
    </p>
    <div class="card">
      <div class="toolbar">
        <label class="search-input"
          ><Search :size="16" /><input
            v-model="search"
            :aria-label="'Buscar ' + titles[kind]"
            placeholder="Buscar por nome…"
            maxlength="120" /></label
        ><span class="toolbar-info"
          >{{ total }} registros ·
          {{
            kind === "municipios" ? "Mato Grosso do Sul" : state.municipio?.nome
          }}</span
        >
      </div>
      <PageState
        :loading="loading"
        :error="error"
        :empty="!rows.length"
        :title="
          search
            ? 'Nenhum resultado encontrado'
            : 'Seu próximo cadastro começa aqui'
        "
        :description="
          search
            ? 'Tente buscar com outro nome.'
            : 'Use o botão de cadastro para organizar sua operação.'
        "
        @retry="load"
      />
      <div v-if="!loading && !error && rows.length" class="table-scroll">
        <table
          class="responsive-table registry-table"
          role="table"
          :aria-label="titles[kind]"
        >
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Nome</th>
              <th role="columnheader">
                {{
                  kind === "equipe"
                    ? "Perfil"
                    : kind === "municipios"
                      ? "UF"
                      : kind === "moradores"
                        ? "Bairro"
                        : "Local"
                }}
              </th>
              <th role="columnheader">Situação</th>
              <th class="actions-th" role="columnheader">Ações</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <tr v-for="row in rows" :key="row.id" role="row">
              <td class="entity-column" role="cell">
                <div class="entity-cell">
                  <span class="entity-icon"
                    ><Building2
                      v-if="kind === 'municipios'"
                      :size="17" /><MapPin
                      v-else-if="kind === 'pontos'"
                      :size="17" /><Users v-else :size="17" /></span
                  ><span
                    ><span class="entity-name">{{ row.nome }}</span
                    ><span class="entity-meta">{{
                      kind === "equipe"
                        ? row.email
                        : kind === "pontos"
                          ? `${row.lat}, ${row.lng}`
                          : "Identificação permanente"
                    }}</span></span
                  >
                </div>
              </td>
              <td
                role="cell"
                :data-label="
                  kind === 'equipe'
                    ? 'Perfil'
                    : kind === 'municipios'
                      ? 'UF'
                      : kind === 'moradores'
                        ? 'Bairro'
                        : 'Local'
                "
              >
                {{
                  kind === "equipe"
                    ? roleLabel[row.role!]
                    : kind === "municipios"
                      ? row.uf
                      : kind === "moradores"
                        ? row.bairro || "—"
                        : row.local
                }}
              </td>
              <td role="cell" data-label="Situação">
                <span class="badge" :class="row.ativo ? 'green' : 'amber'">{{
                  row.ativo ? "Ativo" : "Inativo"
                }}</span>
              </td>
              <td class="actions-column" role="cell" data-label="Ações">
                <div class="row-actions">
                  <button
                    v-if="kind === 'municipios'"
                    class="button soft small"
                    @click="choose(row)"
                  >
                    Abrir<ArrowUpRight :size="13" /></button
                  ><button
                    v-if="kind === 'moradores'"
                    class="icon-button"
                    :aria-label="'QR de ' + row.nome"
                    @click="showQr(row)"
                  >
                    <QrCode :size="17" /></button
                  ><button
                    class="icon-button"
                    :disabled="!writable || row.id === state.user?.id"
                    :aria-label="'Editar ' + row.nome"
                    @click="edit(row)"
                  >
                    <Pencil :size="16" /></button
                  ><button
                    class="icon-button"
                    :disabled="!writable || row.id === state.user?.id"
                    :aria-label="
                      (row.ativo ? 'Desativar ' : 'Ativar ') + row.nome
                    "
                    @click="ask(row, 'ativo')"
                  >
                    <Power :size="16" /></button
                  ><template v-if="kind === 'equipe'"
                    ><button
                      class="icon-button"
                      :disabled="!writable || row.id === state.user?.id"
                      :aria-label="'Redefinir acesso de ' + row.nome"
                      @click="ask(row, 'redefinirSenha')"
                    >
                      <KeyRound :size="16" /></button
                    ><button
                      class="icon-button danger"
                      :disabled="!writable || row.id === state.user?.id"
                      :aria-label="'Excluir conta de ' + row.nome"
                      @click="ask(row, 'excluir')"
                    >
                      <Trash2 :size="16" /></button></template
                  ><button
                    v-if="kind === 'pontos'"
                    class="icon-button danger"
                    :disabled="!writable"
                    :aria-label="'Excluir ' + row.nome"
                    @click="ask(row, 'excluir')"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination
        v-if="!error && !loading"
        :page="page"
        :total="total"
        @change="
          page = $event;
          load();
        "
      />
    </div>
  </template>
  <UiDialog
    v-model:open="open"
    :wide="kind === 'pontos'"
    :title="(editing ? 'Editar ' : 'Cadastrar ') + singular[kind]"
    :description="
      kind === 'equipe'
        ? 'A conta pertence apenas a este município. A senha temporária será exibida após a criação.'
        : kind === 'pontos'
          ? 'Informe o nome e a referência do local, depois clique no mapa para marcar o ponto.'
          : 'Use informações atualizadas para facilitar a operação.'
    "
  >
    <form @submit.prevent="save">
      <div class="form-grid">
        <label class="full-width"
          >Nome<select
            v-if="kind === 'municipios'"
            v-model="form.nome"
            aria-label="Nome"
            required
          >
            <option value="" disabled>Selecione o município</option>
            <option
              v-for="city in municipiosMS"
              :key="city.ibge"
              :value="city.nome"
            >
              {{ city.nome }}
            </option>
            <option
              v-if="
                form.nome &&
                !municipiosMS.some((city) => city.nome === form.nome)
              "
              :value="form.nome"
              disabled
            >
              {{ form.nome }} — selecione um município de MS
            </option></select
          ><input
            v-else
            v-model="form.nome"
            required
            minlength="2"
            maxlength="120"
            autocomplete="off" /></label
        ><label v-if="kind === 'municipios'"
          >UF<input value="Mato Grosso do Sul (MS)" disabled /></label
        ><label v-if="kind === 'moradores'" class="full-width"
          >Bairro<input v-model="form.bairro" maxlength="80" /></label
        ><template v-if="kind === 'pontos'"
          ><label class="full-width"
            >Endereço ou referência<input
              v-model="form.local"
              required
              minlength="2"
              maxlength="180" /></label
          ><PointLocationPicker
            v-if="open && state.municipio"
            v-model="pointLocation"
            :key="state.municipio.id + ':' + (editing?.id || 'new')"
            :municipio="state.municipio"
            :disabled="saving" /></template
        ><template v-if="kind === 'equipe'"
          ><label class="full-width"
            >E-mail<input
              v-model="form.email"
              type="email"
              required
              :disabled="!!editing"
              maxlength="254"
              autocomplete="off" /></label
          ><label class="full-width"
            >Perfil<select
              v-model="form.role"
              aria-label="Perfil"
              aria-describedby="team-role-help"
            >
              <option value="coletor">Coletor</option>
              <option value="gestor">Gestor municipal</option>
            </select></label
          >
          <p id="team-role-help" class="hint full-width">
            Gestores podem administrar outros gestores e coletores desta cidade.
          </p></template
        ><label v-else
          >Situação<select v-model="form.ativo" aria-label="Situação">
            <option :value="true">Ativo</option>
            <option :value="false">Inativo</option>
          </select></label
        >
      </div>
      <p v-if="formError" class="alert error" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <button
          type="button"
          class="button secondary"
          :disabled="saving"
          @click="open = false"
        >
          Cancelar</button
        ><button class="button primary" :disabled="saving">
          {{ saving ? "Salvando…" : "Salvar cadastro" }}
        </button>
      </div>
    </form>
  </UiDialog>
  <UiDialog
    :open="!!confirmation"
    @update:open="!$event && (confirmation = null)"
    :title="
      confirmation?.action === 'excluir'
        ? kind === 'pontos'
          ? 'Excluir ponto de coleta'
          : 'Excluir conta'
        : confirmation?.action === 'redefinirSenha'
          ? 'Redefinir acesso'
          : confirmation?.row.ativo
            ? 'Desativar cadastro'
            : 'Ativar cadastro'
    "
    :description="confirmation?.row.nome || ''"
    ><p class="lead">
      {{
        confirmation?.action === "redefinirSenha"
          ? "Uma nova senha temporária será gerada. As sessões atuais serão encerradas."
          : confirmation?.action === "excluir"
            ? kind === "pontos"
              ? "O ponto será excluído dos cadastros, do mapa e das novas coletas. As entregas já recebidas serão preservadas; pendências ainda não enviadas para este ponto serão rejeitadas e continuarão na fila."
              : "O acesso será revogado imediatamente. As entregas e o registro de auditoria serão preservados."
            : "A nova situação será aplicada à operação após a reconexão."
      }}
    </p>
    <p v-if="formError" class="alert error" role="alert">{{ formError }}</p>
    <div class="form-actions">
      <button
        class="button secondary"
        :disabled="saving"
        @click="confirmation = null"
      >
        Cancelar</button
      ><button
        class="button"
        :class="confirmation?.action === 'excluir' ? 'danger' : 'primary'"
        :disabled="saving"
        @click="confirm"
      >
        {{
          saving
            ? "Aplicando…"
            : confirmation?.action === "excluir"
              ? "Excluir"
              : "Confirmar alteração"
        }}
      </button>
    </div></UiDialog
  >
  <UiDialog
    :open="!!temporary"
    @update:open="!$event && (temporary = '')"
    title="Acesso preparado"
    description="Entregue esta senha à pessoa por um canal privado. Ela precisará alterá-la no primeiro acesso."
    ><p class="alert warning">
      A senha aparece apenas nesta etapa. Guarde-a antes de fechar.
    </p>
    <div class="temporary-password">{{ temporary }}</div>
    <div class="form-actions">
      <button class="button primary" @click="temporary = ''">
        Já guardei a senha
      </button>
    </div></UiDialog
  >
  <UiDialog
    :open="!!qrResident"
    @update:open="!$event && (qrResident = null)"
    title="QR do morador"
    :description="qrResident?.nome || ''"
    ><div class="qr-panel">
      <canvas ref="qrCanvas" aria-label="Código QR de identificação" />
      <p class="qr-code">recicla:morador:{{ qrResident?.id }}</p>
      <p class="hint">O código contém somente a identificação do cadastro.</p>
      <button class="button primary" @click="downloadQr">
        <Download :size="16" />Baixar QR
      </button>
    </div></UiDialog
  >
</template>

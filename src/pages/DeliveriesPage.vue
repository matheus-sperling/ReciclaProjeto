<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { Download, Building2, RefreshCw } from "lucide-vue-next";
import { request, state, number, dateTime } from "../lib/api";
import { downloadJson } from "../lib/offline";
import PageState from "../components/PageState.vue";
import Pagination from "../components/Pagination.vue";
import type { Entrega } from "../../shared/contracts";
const rows = ref<Entrega[]>([]),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  exporting = ref(false),
  error = ref("");
let generation = 0;
async function load() {
  const id = ++generation;
  rows.value = [];
  error.value = "";
  if (!state.municipio) return;
  loading.value = true;
  try {
    const r = await request<{ entregas: Entrega[]; total: number }>(
      "entregas",
      { query: { page: page.value } },
    );
    if (id === generation) {
      rows.value = r.entregas;
      total.value = r.total;
    }
  } catch (e) {
    if (id === generation) error.value = (e as Error).message;
  } finally {
    if (id === generation) loading.value = false;
  }
}
async function exportAll() {
  const scope = state.municipio?.id;
  exporting.value = true;
  error.value = "";
  try {
    const all: Entrega[] = [];
    const snapshot = new Date().toISOString();
    for (let p = 1; ; p++) {
      const r = await request<{ entregas: Entrega[]; total: number }>(
        "entregas",
        { query: { page: p, snapshot } },
      );
      if (state.municipio?.id !== scope)
        throw new Error("O município selecionado mudou.");
      all.push(...r.entregas);
      if (all.length >= r.total) break;
    }
    downloadJson(
      { municipio: state.municipio, geradoEm: snapshot, entregas: all },
      "recicla-entregas-" + scope + ".json",
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    exporting.value = false;
  }
}
watch(
  () => state.municipio?.id,
  () => {
    page.value = 1;
    load();
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="breadcrumb-label">REGISTROS DA OPERAÇÃO</div>
      <h1>Entregas recebidas</h1>
      <p>Recibos confirmados e histórico de coleta do município.</p>
    </div>
    <div class="heading-actions">
      <button
        class="button secondary"
        :disabled="loading || !state.municipio"
        @click="load"
      >
        <RefreshCw :size="15" />Atualizar</button
      ><button
        class="button primary"
        :disabled="exporting || !state.municipio"
        @click="exportAll"
      >
        <Download :size="15" />{{
          exporting ? "Preparando…" : "Exportar histórico"
        }}
      </button>
    </div>
  </div>
  <div v-if="!state.municipio" class="card scope-empty">
    <Building2 :size="40" />
    <h2>Escolha um município</h2>
    <p>Selecione a cidade para consultar ou exportar as entregas.</p>
    <RouterLink class="button primary" to="/municipios"
      >Selecionar município</RouterLink
    >
  </div>
  <div v-else class="card">
    <PageState
      :loading="loading"
      :error="error"
      :empty="!rows.length"
      title="As primeiras entregas aparecerão aqui"
      description="O coletor precisa sincronizar os registros para gerar os recibos."
      @retry="load"
    />
    <div v-if="rows.length && !loading && !error" class="table-scroll">
      <table
        class="responsive-table delivery-table"
        role="table"
        aria-label="Entregas recebidas"
      >
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">Entrega</th>
            <th role="columnheader">Morador / Coletor</th>
            <th role="columnheader">Ponto / Material</th>
            <th role="columnheader">Peso</th>
            <th role="columnheader">Recibo</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          <tr v-for="row in rows" :key="row.id" role="row">
            <td role="cell" data-label="Entrega">
              {{ dateTime(row.criadoEm)
              }}<span class="entity-meta mono">{{ row.id }}</span>
            </td>
            <td role="cell" data-label="Morador / Coletor">
              <span class="entity-name">{{ row.moradorNome }}</span
              ><span class="entity-meta">{{ row.coletorNome }}</span>
            </td>
            <td role="cell" data-label="Ponto / Material">
              {{ row.pontoNome
              }}<span class="entity-meta">{{ row.materialNome }}</span>
            </td>
            <td role="cell" data-label="Peso">
              <strong>{{ number(row.kg) }} kg</strong>
            </td>
            <td role="cell" data-label="Recibo">
              <span class="badge green">Recebido</span
              ><span class="entity-meta">{{
                row.recebidoEm ? dateTime(row.recebidoEm) : ""
              }}</span>
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

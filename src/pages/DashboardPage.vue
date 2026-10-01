<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Building2,
  Leaf,
  Scale,
  PackageCheck,
  MapPin,
  RefreshCw,
  CalendarDays,
} from "lucide-vue-next";
import L from "leaflet";
import {
  Chart,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
} from "chart.js";
import { request, state, number, dateTime } from "../lib/api";
import PageState from "../components/PageState.vue";
import type { Painel } from "../../shared/contracts";
Chart.register(ArcElement, DoughnutController, Tooltip, Legend);
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Campo_Grande",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const inicio = ref(today.slice(0, 7) + "-01"),
  fim = ref(today),
  data = ref<Painel | null>(null),
  loading = ref(false),
  error = ref(""),
  mapElement = ref<HTMLDivElement>(),
  chartElement = ref<HTMLCanvasElement>();
const colors = ["#237553", "#6ab689", "#b6d5a5", "#e3bf72", "#87afad"];
let map: L.Map | undefined,
  chart: Chart | undefined,
  timer: ReturnType<typeof setInterval>,
  generation = 0;
function destroy() {
  map?.remove();
  map = undefined;
  chart?.destroy();
  chart = undefined;
}
async function render() {
  destroy();
  if (!data.value) return;
  await nextTick();
  const points = data.value.pontos.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (mapElement.value && points.length) {
    map = L.map(mapElement.value, { scrollWheelZoom: false }).setView(
      [points[0]!.lat, points[0]!.lng],
      12,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    const bounds: L.LatLngExpression[] = [];
    points.forEach((p) => {
      bounds.push([p.lat, p.lng]);
      const popup = document.createElement("div"),
        title = document.createElement("strong"),
        caption = document.createElement("p");
      title.textContent = p.nome;
      caption.textContent =
        p.local + " · " + number(p.kg) + " kg" + (p.ativo ? "" : " · Inativo");
      popup.append(title, caption);
      L.circleMarker([p.lat, p.lng], {
        radius: 8,
        color: "#17694d",
        weight: 2,
        fillColor: p.ativo ? "#6bb488" : "#aaa",
        fillOpacity: 1,
      })
        .addTo(map!)
        .bindPopup(popup);
    });
    if (points.length > 1)
      map.fitBounds(L.latLngBounds(bounds), { padding: [25, 25], maxZoom: 14 });
  }
  if (chartElement.value && data.value.totalKg > 0)
    chart = new Chart(chartElement.value, {
      type: "doughnut",
      data: {
        labels: data.value.materiais.map((m) => m.nome),
        datasets: [
          {
            data: data.value.materiais.map((m) => m.kg),
            backgroundColor: colors,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "73%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => `${c.label}: ${number(Number(c.raw))} kg`,
            },
          },
        },
      },
    });
}
async function load(quiet = false) {
  const id = ++generation;
  error.value = "";
  if (!state.municipio) {
    data.value = null;
    destroy();
    return;
  }
  if (!quiet) loading.value = true;
  try {
    const result = await request<Painel>("painel", {
      query: { inicio: inicio.value, fim: fim.value },
    });
    if (id === generation) {
      data.value = result;
      await render();
    }
  } catch (e) {
    if (id === generation) error.value = (e as Error).message;
  } finally {
    if (id === generation) loading.value = false;
  }
}
watch(
  () => state.municipio?.id,
  () => {
    data.value = null;
    destroy();
    load();
  },
  { immediate: true },
);
onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden && state.municipio && !loading.value) load(true);
  }, 30000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  generation++;
  destroy();
});
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="breadcrumb-label">VISÃO DA OPERAÇÃO</div>
      <h1>Painel municipal</h1>
      <p>O resultado da coleta, em uma visão clara do seu município.</p>
    </div>
    <form class="filter-bar" @submit.prevent="load()">
      <label>De<input v-model="inicio" type="date" required /></label
      ><label>Até<input v-model="fim" type="date" required /></label
      ><button
        class="button secondary small"
        :disabled="loading || !state.municipio"
      >
        <CalendarDays :size="15" />Aplicar
      </button>
    </form>
  </div>
  <div v-if="!state.municipio" class="card scope-empty">
    <Building2 :size="40" />
    <h2>Selecione uma cidade</h2>
    <p>Cada painel apresenta apenas a operação do município selecionado.</p>
    <RouterLink class="button primary" to="/municipios"
      >Escolher município</RouterLink
    >
  </div>
  <template v-else
    ><div class="hero-banner">
      <div>
        <span class="eyebrow">RECICLAR TRANSFORMA</span>
        <h2>{{ state.municipio.nome }}, cuidando do futuro.</h2>
        <p>
          Acompanhe as entregas recebidas e descubra como cada ponto contribui
          para a coleta municipal.
        </p>
      </div>
      <Leaf class="hero-icon" :size="85" :stroke-width="1" />
    </div>
    <PageState
      :loading="loading && !data"
      :error="error"
      @retry="load()"
    /><template v-if="data && !error"
      ><div class="metrics-grid">
        <div class="card metric">
          <div class="metric-top">
            Peso coletado<span class="metric-icon"><Scale :size="17" /></span>
          </div>
          <div class="metric-value">
            {{ number(data.totalKg) }} <small>kg</small>
          </div>
          <div class="metric-description">Entregas recebidas no período</div>
        </div>
        <div class="card metric">
          <div class="metric-top">
            Entregas<span class="metric-icon"><PackageCheck :size="17" /></span>
          </div>
          <div class="metric-value">{{ number(data.entregas) }}</div>
          <div class="metric-description">Registros confirmados no sistema</div>
        </div>
        <div class="card metric">
          <div class="metric-top">
            Pontos ativos<span class="metric-icon"><MapPin :size="17" /></span>
          </div>
          <div class="metric-value">{{ data.ativos }}</div>
          <div class="metric-description">Locais disponíveis para a coleta</div>
        </div>
        <div class="card metric">
          <div class="metric-top">
            Materiais<span class="metric-icon"><Leaf :size="17" /></span>
          </div>
          <div class="metric-value">
            {{ data.materiais.filter((m) => m.kg > 0).length }}
            <small>/ {{ data.materiais.length }}</small>
          </div>
          <div class="metric-description">Tipos recebidos no período</div>
        </div>
      </div>
      <div class="dashboard-grid">
        <section class="card">
          <div class="section-heading">
            <div>
              <h2>Coleta no território</h2>
              <p>Explore os pontos e seus resultados.</p>
            </div>
            <span class="badge green">{{ data.pontos.length }} pontos</span>
          </div>
          <div class="map-wrap">
            <div
              v-if="data.pontos.length"
              ref="mapElement"
              class="map-container"
              aria-label="Mapa de pontos de coleta"
            />
            <div v-else class="map-empty">
              <MapPin :size="35" /><strong
                >O mapa começa com seu primeiro ponto</strong
              ><RouterLink class="text-button" to="/pontos"
                >Cadastrar ponto de coleta</RouterLink
              >
            </div>
          </div>
        </section>
        <section class="card">
          <div class="section-heading">
            <div>
              <h2>Materiais reciclados</h2>
              <p>Participação de cada material em quilogramas.</p>
            </div>
            <Leaf :size="19" class="detail-icon" />
          </div>
          <div v-if="data.totalKg" class="chart-wrap">
            <canvas
              ref="chartElement"
              aria-label="Distribuição do peso por material"
              role="img"
            />
          </div>
          <PageState
            v-else
            empty
            title="Aguardando a primeira entrega"
            description="Assim que uma coleta for sincronizada, os resultados aparecerão aqui."
          />
          <div class="material-legend">
            <div
              v-for="(material, i) in data.materiais"
              :key="material.id"
              class="legend-row"
            >
              <span
                ><i
                  class="legend-dot"
                  :style="{ background: colors[i % colors.length] }"
                />{{ material.nome }}</span
              ><strong>{{ number(material.kg) }} kg</strong>
            </div>
          </div>
        </section>
      </div>
      <div class="update-note">
        <RefreshCw :size="12" />Atualizado em
        {{ dateTime(data.atualizadoEm) }} · Horário de Mato Grosso do Sul
      </div></template
    ></template
  >
</template>

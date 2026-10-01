<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LocateFixed, MapPin } from "lucide-vue-next";
import L from "leaflet";
import type { Municipio } from "../../shared/contracts";
import { sedeMunicipal } from "../../shared/municipios";
export interface PointLocation {
  lat: number;
  lng: number;
}
const props = defineProps<{ municipio: Municipio; disabled?: boolean }>();
const location = defineModel<PointLocation | null>({ required: true });
const element = ref<HTMLDivElement>(),
  tileError = ref(false);
const sede = computed(() =>
  sedeMunicipal(props.municipio.nome, props.municipio.uf),
);
let map: L.Map | undefined,
  marker: L.CircleMarker | undefined,
  resize: ResizeObserver | undefined;
function mark(position: L.LatLng) {
  if (props.disabled) return;
  position = position.wrap();
  location.value = {
    lat: Number(position.lat.toFixed(6)),
    lng: Number(position.lng.toFixed(6)),
  };
}
function markCenter() {
  if (map) mark(map.getCenter());
}
function cityView() {
  if (map && sede.value) map.setView([sede.value.lat, sede.value.lng], 13);
}
function renderMarker() {
  marker?.remove();
  marker = undefined;
  if (map && location.value)
    marker = L.circleMarker([location.value.lat, location.value.lng], {
      radius: 10,
      color: "#fff",
      weight: 3,
      fillColor: "#17694d",
      fillOpacity: 1,
    }).addTo(map);
}
onMounted(() => {
  if (!element.value) return;
  const center = location.value || sede.value;
  map = L.map(element.value, { scrollWheelZoom: false }).setView(
    center ? [center.lat, center.lng] : [-20.4, -54.7],
    location.value ? 16 : sede.value ? 13 : 6,
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    maxZoom: 19,
  })
    .on("tileerror", () => {
      tileError.value = true;
    })
    .addTo(map);
  map.on("click", (event: L.LeafletMouseEvent) => mark(event.latlng));
  renderMarker();
  resize = new ResizeObserver(() => map?.invalidateSize());
  resize.observe(element.value);
});
watch(location, renderMarker);
onBeforeUnmount(() => {
  resize?.disconnect();
  map?.remove();
  map = undefined;
});
</script>
<template>
  <section
    class="point-picker full-width"
    aria-label="Localização do ponto de coleta"
    :data-municipio-ibge="sede?.ibge"
  >
    <div class="point-picker-heading">
      <div>
        <strong><MapPin :size="16" />Localização no mapa</strong>
        <p>
          {{ municipio.nome }} · {{ municipio.uf }} — clique onde fica o ponto.
        </p>
      </div>
      <button
        type="button"
        class="button secondary small"
        :disabled="!sede || disabled"
        @click="cityView"
      >
        <LocateFixed :size="15" />Ver município
      </button>
    </div>
    <div class="point-picker-map-wrap">
      <div
        ref="element"
        class="point-picker-map"
        :aria-label="
          'Mapa de ' + municipio.nome + ': clique para marcar o ponto'
        "
        aria-describedby="point-picker-help"
        @keydown.enter.self.prevent="markCenter"
      />
      <span class="map-center-target" aria-hidden="true">+</span>
    </div>
    <div
      class="point-picker-selection"
      :class="{ selected: location }"
      role="status"
    >
      <MapPin :size="16" /><span v-if="location"
        >Local selecionado · {{ location.lat.toFixed(6) }},
        {{ location.lng.toFixed(6) }}</span
      ><span v-else>Nenhum local marcado. Selecione um ponto no mapa.</span>
    </div>
    <p id="point-picker-help" class="hint">
      Arraste o mapa e use + / − para aproximar. Pelo teclado, mova com as setas
      e pressione Enter para marcar o centro.
    </p>
    <button
      type="button"
      class="text-button"
      :disabled="disabled"
      @click="markCenter"
    >
      Marcar no centro do mapa
    </button>
    <p v-if="!sede" class="alert warning">
      O nome cadastrado não corresponde a um município de MS. Peça ao
      administrador para corrigir o município; enquanto isso, localize o ponto
      no mapa.
    </p>
    <p v-if="tileError" class="alert warning" role="status">
      Não foi possível carregar parte do mapa. Confira a conexão antes de
      escolher a localização.
    </p>
  </section>
</template>

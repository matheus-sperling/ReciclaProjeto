<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Leaf,
  LayoutDashboard,
  Users,
  MapPin,
  Building2,
  ShieldCheck,
  PackageCheck,
  ScanLine,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from "lucide-vue-next";
import { authClient, clearContext, state, authError } from "./lib/api";
import { logoutOffline } from "./lib/offline";
import { roleLabel } from "../shared/contracts";
import ThemeToggle from "./components/ThemeToggle.vue";
const route = useRoute(),
  router = useRouter(),
  menu = ref(false),
  error = ref(""),
  leaving = ref(false);
watch(
  () => route.path,
  () => {
    menu.value = false;
    error.value = "";
  },
);
const nav = computed(() => [
  ...(state.user?.role === "administrador"
    ? [{ to: "/municipios", label: "Municípios", icon: Building2 }]
    : []),
  ...(state.user?.role !== "coletor"
    ? [
        { to: "/painel", label: "Visão geral", icon: LayoutDashboard },
        { to: "/moradores", label: "Moradores", icon: Users },
        { to: "/pontos", label: "Pontos de coleta", icon: MapPin },
        { to: "/equipe", label: "Equipe", icon: Users },
        { to: "/entregas", label: "Entregas", icon: PackageCheck },
      ]
    : []),
  ...(state.user?.role !== "administrador"
    ? [{ to: "/coletor", label: "Coletor", icon: ScanLine }]
    : []),
  { to: "/seguranca", label: "Segurança", icon: ShieldCheck },
]);
const initials = computed(() =>
  state.user?.nome
    .split(" ")
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase(),
);
const shell = computed(
  () => !route.meta.public && route.path !== "/coletor" && !!state.user,
);
async function logout() {
  if (leaving.value) return;
  leaving.value = true;
  error.value = "";
  try {
    const result = await authClient.signOut();
    if (result.error) throw new Error(authError(result.error));
    if (state.user) logoutOffline(state.user);
    state.user = null;
    clearContext();
    sessionStorage.removeItem("recicla-municipio");
    await router.push("/entrar");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Não foi possível sair.";
  } finally {
    leaving.value = false;
  }
}
</script>
<template>
  <div v-if="shell" class="app-shell">
    <button
      v-if="menu"
      class="mobile-scrim"
      aria-label="Fechar menu"
      @click="menu = false"
    />
    <aside class="sidebar" :class="{ open: menu }">
      <RouterLink to="/" class="brand"
        ><span class="brand-icon"><Leaf :size="23" /></span
        ><span
          >Recicla<span class="brand-plus">+</span
          ><small>GESTÃO MUNICIPAL</small></span
        ></RouterLink
      >
      <button
        class="icon-button sidebar-close"
        aria-label="Fechar menu"
        @click="menu = false"
      >
        <X :size="20" />
      </button>
      <div class="workspace-label">ESPAÇO DE TRABALHO</div>
      <div class="municipio-card">
        <Building2 :size="18" />
        <div>
          <strong>{{ state.municipio?.nome || "Plataforma" }}</strong
          ><small>{{
            state.municipio ? "Mato Grosso do Sul" : "Administração geral"
          }}</small>
        </div>
      </div>
      <nav aria-label="Navegação principal">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          ><component :is="item.icon" :size="19" /><span>{{ item.label }}</span
          ><ChevronRight class="nav-arrow" :size="15"
        /></RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <Leaf :size="18" />
          <p>
            Cada entrega conta.<br /><strong>Cada cidade transforma.</strong>
          </p>
        </div>
        <ThemeToggle />
      </div>
    </aside>
    <div class="workspace">
      <header class="app-topbar">
        <div class="topbar-left">
          <button
            class="icon-button mobile-menu"
            aria-label="Abrir menu"
            :aria-expanded="menu"
            @click="menu = true"
          >
            <Menu :size="22" /></button
          ><span>Recicla+</span><ChevronRight :size="14" /><strong>{{
            route.meta.title
          }}</strong>
        </div>
        <div class="user-menu">
          <div class="avatar">{{ initials }}</div>
          <div class="user-details">
            <strong>{{ state.user?.nome }}</strong
            ><small>{{ state.user ? roleLabel[state.user.role] : "" }}</small>
          </div>
          <button
            class="icon-button"
            aria-label="Sair da conta"
            :disabled="leaving"
            @click="logout"
          >
            <LogOut :size="18" />
          </button>
        </div>
      </header>
      <main class="main-content">
        <p v-if="error" class="alert error" role="alert">{{ error }}</p>
        <RouterView v-slot="{ Component }"
          ><component :is="Component" :key="route.path"
        /></RouterView>
      </main>
      <footer class="app-footer">
        <span>Recicla+ · Coleta seletiva, gestão consciente.</span
        ><span><span class="status-dot" /> Ambiente municipal protegido</span>
      </footer>
    </div>
  </div>
  <template v-else>
    <div v-if="route.path !== '/coletor'" class="public-theme-control">
      <ThemeToggle compact />
    </div>
    <RouterView />
  </template>
</template>

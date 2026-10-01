import { createRouter, createWebHistory } from "vue-router";
import { session, state, ApiError } from "./lib/api";
import { restoreOfflineUser } from "./lib/offline";
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: () =>
        state.user?.role === "administrador"
          ? "/municipios"
          : state.user?.role === "coletor"
            ? "/coletor"
            : "/painel",
    },
    {
      path: "/entrar",
      component: () => import("./pages/LoginPage.vue"),
      meta: { public: true, title: "Acesse sua conta" },
    },
    {
      path: "/ativar",
      component: () => import("./pages/ActivationPage.vue"),
      meta: { public: true, title: "Primeiro acesso" },
    },
    {
      path: "/seguranca",
      component: () => import("./pages/SecurityPage.vue"),
      meta: { title: "Segurança da conta" },
    },
    {
      path: "/municipios",
      component: () => import("./pages/RegistryPage.vue"),
      props: { kind: "municipios" },
      meta: { title: "Municípios", admin: true },
    },
    {
      path: "/painel",
      component: () => import("./pages/DashboardPage.vue"),
      meta: { title: "Visão geral", manager: true, scope: true },
    },
    {
      path: "/moradores",
      component: () => import("./pages/RegistryPage.vue"),
      props: { kind: "moradores" },
      meta: { title: "Moradores", manager: true, scope: true },
    },
    {
      path: "/equipe",
      component: () => import("./pages/RegistryPage.vue"),
      props: { kind: "equipe" },
      meta: { title: "Equipe", manager: true, scope: true },
    },
    {
      path: "/pontos",
      component: () => import("./pages/RegistryPage.vue"),
      props: { kind: "pontos" },
      meta: { title: "Pontos de coleta", manager: true, scope: true },
    },
    {
      path: "/entregas",
      component: () => import("./pages/DeliveriesPage.vue"),
      meta: { title: "Entregas recebidas", manager: true, scope: true },
    },
    {
      path: "/coletor",
      component: () => import("./pages/CollectorPage.vue"),
      meta: { title: "Coletor", collector: true },
    },
    { path: "/coletor/index.html", redirect: "/coletor" },
    {
      path: "/:pathMatch(.*)*",
      component: () => import("./pages/NotFoundPage.vue"),
      meta: { public: true, title: "Página não encontrada" },
    },
  ],
});
router.beforeEach(async (to) => {
  if (!to.meta.public && !state.user) {
    try {
      await session();
    } catch (error) {
      const offline =
        to.path === "/coletor" &&
        error instanceof ApiError &&
        error.status === 0
          ? restoreOfflineUser()
          : null;
      if (offline) {
        state.user = offline;
        state.municipio = offline.municipio;
      } else return { path: "/entrar", query: { redirect: to.path } };
    }
  }
  state.checking = false;
  if (state.user && !to.meta.public) {
    if (
      (state.user.mustChangePassword ||
        (state.user.role === "administrador" &&
          !state.user.twoFactorEnabled)) &&
      to.path !== "/seguranca"
    )
      return "/seguranca";
    if (to.meta.admin && state.user.role !== "administrador") return "/painel";
    if (to.meta.manager && state.user.role === "coletor") return "/coletor";
    if (to.meta.collector && state.user.role === "administrador")
      return "/municipios";
  }
});

import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initializeTheme } from "./lib/theme";
import { clearContext, flushPendingLogout, state } from "./lib/api";
import { deviceLock, deviceLockKey } from "./lib/device-lock";
import "./styles.css";
initializeTheme();
window.addEventListener("storage", (event) => {
  if (event.key !== deviceLockKey || !deviceLock()) return;
  state.user = null;
  clearContext();
  void router.replace("/entrar");
});
window.addEventListener("online", () => {
  void flushPendingLogout().catch(() => {});
});
createApp(App).use(router).mount("#app");

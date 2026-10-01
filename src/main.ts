import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initializeTheme } from "./lib/theme";
import "./styles.css";
initializeTheme();
createApp(App).use(router).mount("#app");

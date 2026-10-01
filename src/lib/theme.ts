import { readonly, ref } from "vue";

const storageKey = "recicla-theme";
const dark = ref(false);
let initialized = false;

function apply(value: boolean, persist = false) {
  dark.value = value;
  document.documentElement.classList.toggle("dark", value);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", value ? "#101b17" : "#f5f7f6");
  if (persist) {
    try {
      localStorage.setItem(storageKey, value ? "dark" : "light");
    } catch {
      // The current theme still works when browser storage is unavailable.
    }
  }
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  let saved = "light";
  try {
    saved = localStorage.getItem(storageKey) || "light";
  } catch {}
  apply(saved === "dark");
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null)
      apply(event.newValue === "dark");
  });
}

export function useTheme() {
  initializeTheme();
  return {
    dark: readonly(dark),
    toggleTheme: () => apply(!dark.value, true),
  };
}

<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next";
import { useTheme } from "../lib/theme";

defineProps<{ compact?: boolean }>();
const { dark, toggleTheme } = useTheme();
</script>

<template>
  <button
    type="button"
    :class="compact ? 'icon-button' : 'theme-button'"
    :aria-label="dark ? 'Ativar modo claro' : 'Ativar modo escuro'"
    :title="dark ? 'Ativar modo claro' : 'Ativar modo escuro'"
    @click="toggleTheme"
  >
    <component :is="dark ? Sun : Moon" :size="19" />
    <span v-if="!compact">{{
      dark ? "Aparência clara" : "Aparência escura"
    }}</span>
  </button>
</template>

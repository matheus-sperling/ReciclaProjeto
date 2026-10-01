<script setup lang="ts">
import { AlertCircle, Inbox, LoaderCircle } from "lucide-vue-next";
defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  title?: string;
  description?: string;
}>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="loading" class="state-panel" role="status">
    <LoaderCircle class="spin" :size="28" /><strong
      >Carregando informações</strong
    >
    <p>Estamos preparando sua visão municipal.</p>
  </div>
  <div v-else-if="error" class="state-panel error-state" role="alert">
    <AlertCircle :size="28" /><strong>Não foi possível carregar</strong>
    <p>{{ error }}</p>
    <button class="button secondary" @click="$emit('retry')">
      Tentar novamente
    </button>
  </div>
  <div v-else-if="empty" class="state-panel">
    <Inbox :size="32" /><strong>{{
      title || "Tudo pronto para começar"
    }}</strong>
    <p>
      {{
        description || "Os registros aparecerão aqui quando forem cadastrados."
      }}
    </p>
    <slot />
  </div>
</template>

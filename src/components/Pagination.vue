<script setup lang="ts">
defineProps<{ page: number; total: number }>();
defineEmits<{ change: [page: number] }>();
</script>
<template>
  <div class="pagination">
    <span
      >{{ total }} registro{{ total === 1 ? "" : "s" }} · Página {{ page }} de
      {{ Math.max(1, Math.ceil(total / 30)) }}</span
    >
    <div>
      <button
        class="button secondary small"
        :disabled="page <= 1"
        @click="$emit('change', page - 1)"
      >
        Anterior</button
      ><button
        class="button secondary small"
        :disabled="page * 30 >= total"
        @click="$emit('change', page + 1)"
      >
        Próxima
      </button>
    </div>
  </div>
</template>

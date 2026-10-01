<script setup lang="ts">
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "reka-ui";
import { X } from "lucide-vue-next";
defineProps<{ title: string; description?: string; wide?: boolean }>();
const open = defineModel<boolean>("open", { required: true });
</script>
<template>
  <DialogRoot v-model:open="open"
    ><DialogPortal
      ><DialogOverlay class="dialog-overlay" /><DialogContent
        class="dialog-content"
        :class="{ 'dialog-wide': wide }"
        @interact-outside="$event.preventDefault()"
      >
        <header class="dialog-heading">
          <div>
            <DialogTitle class="dialog-title">{{ title }}</DialogTitle
            ><DialogDescription class="muted">{{
              description || "Revise as informações antes de confirmar."
            }}</DialogDescription>
          </div>
          <DialogClose class="icon-button" aria-label="Fechar"
            ><X :size="20"
          /></DialogClose>
        </header>
        <slot /> </DialogContent></DialogPortal
  ></DialogRoot>
</template>

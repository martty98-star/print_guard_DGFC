<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const title = computed(() => route.meta.title || route.name || 'Screen');
const routeName = computed(() => String(route.name || ''));
</script>

<template>
  <div class="pg-placeholder">
    <h1 class="pg-placeholder__title">
      {{ title }}
    </h1>
    <p class="pg-placeholder__meta">
      Route name: <code>{{ routeName }}</code>
    </p>
    <p class="pg-placeholder__note">
      Placeholder — legacy app remains at the root <code>index.html</code>.
    </p>
  </div>
</template>

<style scoped>
.pg-placeholder__title {
  font-size: 1.25rem;
  margin: 0 0 0.5rem;
}

.pg-placeholder__meta {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: #5c5346;
}

.pg-placeholder__meta code {
  font-size: 0.8rem;
}

.pg-placeholder__note {
  margin: 0;
  font-size: 0.875rem;
  color: #7a7163;
}

.pg-placeholder__note code {
  font-size: 0.8rem;
}
</style>

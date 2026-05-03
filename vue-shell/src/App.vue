<script setup>
import { RouterLink, RouterView } from 'vue-router';

const navGroups = [
  {
    label: 'Stock',
    links: [
      { path: '/stock-overview', label: 'Overview' },
      { path: '/stock-movement', label: 'Movement' },
      { path: '/stock-alerts', label: 'Alerts' },
      { path: '/checklist', label: 'Checklist' },
      { path: '/stock-log', label: 'History' },
      { path: '/stock-items', label: 'Items' },
      { path: '/stock-detail', label: 'Detail' },
    ],
  },
  {
    label: 'Colorado',
    links: [
      { path: '/co-dashboard', label: 'Dashboard' },
      { path: '/co-entry', label: 'Entry' },
      { path: '/co-history', label: 'History' },
      { path: '/print-log', label: 'Print log' },
      { path: '/postpurchase-orders', label: 'Post-purchase' },
    ],
  },
  {
    label: 'App',
    links: [
      { path: '/', label: 'Home' },
      { path: '/settings', label: 'Settings' },
    ],
  },
];
</script>

<template>
  <div class="pg-vue-shell">
    <header class="pg-vue-shell__header">
      <strong>PrintGuard</strong>
      <span class="pg-vue-shell__badge">Vue shell (experiment)</span>
    </header>
    <div class="pg-vue-shell__body">
      <aside class="pg-vue-shell__aside" aria-label="Placeholder navigation">
        <nav
          v-for="group in navGroups"
          :key="group.label"
          class="pg-vue-shell__nav-group"
        >
          <div class="pg-vue-shell__nav-label">
            {{ group.label }}
          </div>
          <RouterLink
            v-for="link in group.links"
            :key="link.path"
            :to="link.path"
            class="pg-vue-shell__link"
            active-class="pg-vue-shell__link--active"
          >
            {{ link.label }}
          </RouterLink>
        </nav>
      </aside>
      <main class="pg-vue-shell__main">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.pg-vue-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
  color: #1a1a1a;
  background: #f5f2ed;
}

.pg-vue-shell__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #d4cfc4;
  background: #fff;
}

.pg-vue-shell__badge {
  font-size: 0.75rem;
  font-weight: 500;
  color: #5c5346;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: #ebe6dc;
}

.pg-vue-shell__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pg-vue-shell__aside {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid #d4cfc4;
  background: #faf8f4;
  padding: 0.75rem;
  overflow: auto;
}

.pg-vue-shell__nav-group {
  margin-bottom: 1rem;
}

.pg-vue-shell__nav-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #7a7163;
  margin-bottom: 0.35rem;
}

.pg-vue-shell__link {
  display: block;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  color: #2c2720;
  text-decoration: none;
  font-size: 0.875rem;
}

.pg-vue-shell__link:hover {
  background: #ebe6dc;
}

.pg-vue-shell__link--active {
  background: #e0d8ca;
  font-weight: 600;
}

.pg-vue-shell__main {
  flex: 1;
  padding: 1rem 1.25rem;
  overflow: auto;
}
</style>

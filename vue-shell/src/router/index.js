import { createRouter, createWebHistory } from 'vue-router';

import ShellPlaceholder from '../views/ShellPlaceholder.vue';

function placeholder(path, name, title) {
  return {
    path,
    name,
    component: ShellPlaceholder,
    meta: { title },
  };
}

const routes = [
  placeholder('/', 'home', 'Home'),
  placeholder('/stock-overview', 'stock-overview', 'Stock · Overview'),
  placeholder('/stock-movement', 'stock-movement', 'Stock · Movement'),
  placeholder('/stock-alerts', 'stock-alerts', 'Stock · Alerts'),
  placeholder('/checklist', 'checklist', 'Checklist'),
  placeholder('/stock-log', 'stock-log', 'Stock · History'),
  placeholder('/stock-items', 'stock-items', 'Stock · Items'),
  placeholder('/stock-detail', 'stock-detail', 'Stock · Detail'),
  placeholder('/co-dashboard', 'co-dashboard', 'Colorado · Dashboard'),
  placeholder('/co-entry', 'co-entry', 'Colorado · Entry'),
  placeholder('/co-history', 'co-history', 'Colorado · History'),
  placeholder('/print-log', 'print-log', 'Print log'),
  placeholder('/postpurchase-orders', 'postpurchase-orders', 'Post-purchase orders'),
  placeholder('/settings', 'settings', 'Settings'),
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;

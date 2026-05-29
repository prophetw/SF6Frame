<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { useLocale, type Locale } from './i18n';

const { locale, setLocale } = useLocale();

function handleLocaleChange(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as Locale);
}
</script>

<template>
  <div class="app">
    <!-- Navigation Header -->
    <header class="nav-header">
      <div class="container">
        <nav class="nav">
          <RouterLink to="/" class="nav-brand">
            <span class="brand-icon">🎮</span>
            <span class="brand-text">SF6 Frame Data</span>
          </RouterLink>
          
          <div class="nav-right">
            <div class="nav-links">
              <RouterLink to="/" class="nav-link">角色列表</RouterLink>
              <RouterLink to="/oki" class="nav-link">压起身计算器</RouterLink>
              <RouterLink to="/gap-calculator" class="nav-link">连招间隙计算器</RouterLink>
              <RouterLink to="/trade-calculator" class="nav-link">相杀计算器</RouterLink>
            </div>

            <div class="nav-actions">
              <select class="lang-select" :value="locale" @change="handleLocaleChange" aria-label="Language">
                <option value="zh-CN">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </nav>
      </div>
    </header>
    
    <!-- Main Content -->
    <main class="main-content">
      <RouterView />
    </main>
    
    <!-- Footer -->
    <footer class="footer">
      <div class="container">
        <p>SF6 Frame Data Tool &copy; 2026 | 数据来源: Supercombo Wiki</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.nav-header {
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: var(--z-dropdown);
  backdrop-filter: blur(10px);
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--color-text-primary);
  text-decoration: none;
}

.brand-icon {
  font-size: 1.5rem;
}

.brand-text {
  background: var(--gradient-fire);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav-links {
  display: flex;
  gap: var(--space-lg);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.nav-actions {
  display: flex;
  align-items: center;
}

.lang-select {
  height: 36px;
  padding: 0 var(--space-sm);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.lang-select:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.nav-link {
  color: var(--color-text-secondary);
  font-weight: 500;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.nav-link:hover,
.nav-link.router-link-active {
  color: var(--color-accent);
  background: var(--color-accent-light);
}

.main-content {
  flex: 1;
  padding: var(--space-xl) 0;
}

.footer {
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-border);
  padding: var(--space-lg) 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* Mobile responsive */
@media (max-width: 640px) {
  .nav {
    flex-direction: column;
    align-items: stretch;
    height: auto;
    padding: var(--space-sm) 0;
    gap: var(--space-sm);
  }

  .nav-brand {
    justify-content: center;
    min-height: 36px;
  }
  
  .nav-right {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    width: 100%;
  }

  .nav-links {
    gap: var(--space-xs);
    flex: 1 1 auto;
    width: calc(100% - 92px);
    max-width: calc(100% - 92px);
    min-width: 0;
    overflow: auto hidden;
    scrollbar-width: none;
  }

  .nav-links::-webkit-scrollbar {
    display: none;
  }
  
  .nav-link {
    flex: 0 0 auto;
    font-size: var(--font-size-sm);
    line-height: 1;
    padding: 10px var(--space-sm);
    white-space: nowrap;
  }

  .nav-actions {
    flex: 0 0 84px;
    justify-content: flex-end;
  }

  .lang-select {
    width: 84px;
    padding: 0 var(--space-xs);
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { SF6_CHARACTERS } from '../types';
import CharacterCard from '../components/CharacterCard.vue';

const characters = computed(() => SF6_CHARACTERS);
</script>

<template>
  <div class="home-view container">
    <!-- Hero Section -->
    <section class="hero">
      <h1 class="hero-title">
        <span class="title-main">街霸6</span>
        <span class="title-sub">帧数表</span>
      </h1>
      <p class="hero-desc">
        查看所有角色的帧数据，了解招式优劣势，提升你的对战水平
      </p>
    </section>
    
    <!-- Character Grid -->
    <section class="characters-section">
      <h2 class="section-title">选择角色</h2>
      <div class="character-grid">
        <CharacterCard
          v-for="char in characters"
          :key="char.id"
          :character="char"
        />
      </div>
    </section>
    
    <!-- Quick Links -->
    <section class="quick-links">
      <RouterLink to="/oki" class="quick-link-card">
        <span class="quick-icon">⏱️</span>
        <div class="quick-content">
          <h3>压起身计算器</h3>
          <p>计算击倒后最佳压起身时机</p>
        </div>
        <span class="quick-arrow">→</span>
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
.home-view {
  padding-bottom: var(--space-2xl);
}

.hero {
  text-align: center;
  padding: var(--space-2xl) 0;
}

.hero-title {
  font-size: 3rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.title-main {
  background: var(--gradient-fire);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.title-sub {
  font-size: 2rem;
  color: var(--color-text-secondary);
  font-weight: 400;
}

.hero-desc {
  color: var(--color-text-muted);
  max-width: 500px;
  margin: var(--space-md) auto 0;
}

.section-title {
  margin-bottom: var(--space-lg);
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
}

.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-md);
}

.quick-links {
  margin-top: var(--space-2xl);
}

.quick-link-card {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  text-decoration: none;
  transition: all var(--transition-normal);
}

.quick-link-card:hover {
  border-color: var(--color-accent);
  transform: translateX(4px);
}

.quick-icon {
  font-size: 2rem;
}

.quick-content {
  flex: 1;
}

.quick-content h3 {
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
}

.quick-content p {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.quick-arrow {
  color: var(--color-accent);
  font-size: 1.5rem;
}

/* Mobile */
@media (max-width: 640px) {
  .hero-title {
    font-size: 2rem;
  }
  
  .title-sub {
    font-size: 1.5rem;
  }
  
  .character-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: var(--space-sm);
  }
}
</style>

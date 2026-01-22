<script setup lang="ts">
import type { Character } from '../types';

const props = defineProps<{
  character: Character;
}>();
</script>

<template>
  <RouterLink :to="`/character/${character.id}`" class="character-card">
    <div class="card-portrait">
      <span class="portrait-placeholder">{{ character.name.charAt(0) }}</span>
    </div>
    <div class="card-info">
      <span class="card-name">{{ character.name }}</span>
      <span class="card-name-jp" v-if="character.nameJp">{{ character.nameJp }}</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.character-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-md);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  text-decoration: none;
  transition: all var(--transition-normal);
}

.character-card:hover {
  border-color: var(--color-accent);
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.card-portrait {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-md);
  background: var(--gradient-dark);
  border: 2px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-sm);
  transition: border-color var(--transition-fast);
}

.character-card:hover .card-portrait {
  border-color: var(--color-accent);
}

.portrait-placeholder {
  font-size: 2rem;
  font-weight: 700;
  background: var(--gradient-fire);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.card-info {
  text-align: center;
}

.card-name {
  display: block;
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.card-name-jp {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: 2px;
}

/* Mobile */
@media (max-width: 640px) {
  .character-card {
    padding: var(--space-sm);
  }
  
  .card-portrait {
    width: 60px;
    height: 60px;
  }
  
  .portrait-placeholder {
    font-size: 1.5rem;
  }
}
</style>

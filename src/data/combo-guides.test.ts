import { describe, expect, it } from 'vitest';
import { SF6_CHARACTERS, type ComboGuide } from '../types';

const guides = import.meta.glob<ComboGuide>('./combo-guides/*.json', { eager: true, import: 'default' });

describe.each(SF6_CHARACTERS)('$name 的常用连段', ({ id }) => {
  it('有来源，每个场景有 3～5 条完整的带使用说明的路线', () => {
    const guide = guides[`./combo-guides/${id}.json`];
    expect(guide).toBeDefined();
    expect(guide.sources.length).toBeGreaterThan(0);
    for (const source of guide.sources) {
      expect(source.label.trim()).toBeTruthy();
      expect(new URL(source.url).protocol).toBe('https:');
    }

    for (const group of [guide.normal, guide.punish, guide.rush]) {
      expect(group.length).toBeGreaterThanOrEqual(3);
      expect(group.length).toBeLessThanOrEqual(5);
      expect(group[0].difficulty).not.toBe('高级');
      expect(new Set(group.map(route => route.input)).size).toBe(group.length);
      for (const route of group) {
        expect(['入门', '中等', '高级']).toContain(route.difficulty);
        expect(route.when.trim()).toBeTruthy();
        expect(route.input).toMatch(/\S\s*(→|~)\s*\S/);
        expect(route.input).not.toMatch(/\.\.\.|…/);
        if (route.source) {
          expect(route.source.label.trim()).toBeTruthy();
          expect(new URL(route.source.url).protocol).toBe('https:');
        }
      }
    }

    for (const route of guide.rush) {
      expect(route.input).toMatch(/(?:^| → )(?:DRC|裸 DR) → /);
    }
  });

  it('有带使用条件和具体出处的打乱动压制', () => {
    const { pressure } = guides[`./combo-guides/${id}.json`];
    expect(pressure.length).toBeGreaterThan(0);
    expect(new Set(pressure.map(route => route.input)).size).toBe(pressure.length);
    for (const route of pressure) {
      expect(route.input).toContain(' → ');
      expect(route.when.trim()).toBeTruthy();
      expect(route.source.label.trim()).toBeTruthy();
      expect(new URL(route.source.url).protocol).toBe('https:');
    }
  });
});

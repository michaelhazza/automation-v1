import { describe, it, expect } from 'vitest';
import { isValidPromotionTransition } from '../memoryConsolidation.js';

describe('isValidPromotionTransition', () => {
  describe('valid transitions return true', () => {
    it('working -> episodic', () => {
      expect(isValidPromotionTransition('working', 'episodic')).toBe(true);
    });

    it('episodic -> semantic', () => {
      expect(isValidPromotionTransition('episodic', 'semantic')).toBe(true);
    });

    it('episodic -> procedural', () => {
      expect(isValidPromotionTransition('episodic', 'procedural')).toBe(true);
    });

    it('semantic -> procedural', () => {
      expect(isValidPromotionTransition('semantic', 'procedural')).toBe(true);
    });
  });

  describe('invalid transitions return false', () => {
    it('working -> semantic', () => {
      expect(isValidPromotionTransition('working', 'semantic')).toBe(false);
    });

    it('working -> procedural', () => {
      expect(isValidPromotionTransition('working', 'procedural')).toBe(false);
    });

    it('episodic -> working', () => {
      expect(isValidPromotionTransition('episodic', 'working')).toBe(false);
    });

    it('semantic -> episodic', () => {
      expect(isValidPromotionTransition('semantic', 'episodic')).toBe(false);
    });

    it('procedural -> working', () => {
      expect(isValidPromotionTransition('procedural', 'working')).toBe(false);
    });

    it('procedural -> episodic', () => {
      expect(isValidPromotionTransition('procedural', 'episodic')).toBe(false);
    });
  });

  describe('self-loops return false', () => {
    it('working -> working', () => {
      expect(isValidPromotionTransition('working', 'working')).toBe(false);
    });

    it('episodic -> episodic', () => {
      expect(isValidPromotionTransition('episodic', 'episodic')).toBe(false);
    });

    it('semantic -> semantic', () => {
      expect(isValidPromotionTransition('semantic', 'semantic')).toBe(false);
    });

    it('procedural -> procedural', () => {
      expect(isValidPromotionTransition('procedural', 'procedural')).toBe(false);
    });
  });
});

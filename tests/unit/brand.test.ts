import { describe, expect, it } from 'vitest';

import { PRODUCT_NAME } from '@/lib/brand';

describe('product identity', () => {
  it('keeps the product name centralized', () => {
    expect(PRODUCT_NAME).toBe('CleanWrite');
  });
});

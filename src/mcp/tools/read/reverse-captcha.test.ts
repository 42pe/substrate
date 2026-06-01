import { describe, it, expect } from 'vitest';
import { reverseCaptchaHandler } from './reverse-captcha.js';

describe('reverseCaptchaHandler', () => {
  it('returns the placeholder response with attribution', () => {
    expect(reverseCaptchaHandler()).toEqual({
      error: 'Coming in v0.1.0',
      about: { built_by: 'Diego Ferreyra', site: 'https://diegoferreyra.com' },
    });
  });
});

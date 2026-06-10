import { describe, it, expect } from 'vitest';
import { TemplateManifestSchema } from './manifest.js';

const valid = {
  name: 'Web Delivery',
  description: 'A delivery workflow',
  version: '1.0.0',
  boards: ['boards/delivery.json'],
};

describe('TemplateManifestSchema', () => {
  it('parses a valid manifest (with optionals)', () => {
    const r = TemplateManifestSchema.safeParse({
      ...valid,
      author: 'Diego',
      homepage: 'https://example.com',
      source: 'https://github.com/x/y',
    });
    expect(r.success).toBe(true);
  });

  it('parses a valid manifest without the optionals', () => {
    expect(TemplateManifestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { name: _omit, ...noName } = valid;
    expect(TemplateManifestSchema.safeParse(noName).success).toBe(false);
    expect(TemplateManifestSchema.safeParse({ ...valid, version: '' }).success).toBe(false);
  });

  it('rejects an unknown key (.strict)', () => {
    expect(TemplateManifestSchema.safeParse({ ...valid, futureKey: true }).success).toBe(false);
  });

  it('rejects an empty boards array (.min(1))', () => {
    expect(TemplateManifestSchema.safeParse({ ...valid, boards: [] }).success).toBe(false);
  });

  it('rejects a board path that is an empty string', () => {
    expect(TemplateManifestSchema.safeParse({ ...valid, boards: [''] }).success).toBe(false);
  });
});

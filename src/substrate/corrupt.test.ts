import { describe, it, expect } from 'vitest';
import { corruptBoardError } from './corrupt.js';

describe('corruptBoardError', () => {
  it('produces a substrate_corrupt error naming the file', () => {
    const err = corruptBoardError({
      file: 'boards/delivery.json',
      problem: 'it is not valid JSON',
    });
    expect(err.code).toBe('substrate_corrupt');
    expect(err.message).toContain('.substrate/boards/delivery.json');
    expect(err.message).toContain('it is not valid JSON');
  });

  it('embeds a paste-able fix prompt in both the message and details', () => {
    const err = corruptBoardError({ file: 'boards/x.json', problem: 'duplicate group id' });
    expect(err.details?.['file']).toBe('boards/x.json');
    const prompt = err.details?.['fix_prompt'];
    expect(typeof prompt).toBe('string');
    expect(prompt as string).toContain('.substrate/boards/x.json');
    // The message embeds the same prompt so a plain-text client still sees it.
    expect(err.message).toContain(prompt as string);
  });

  it('merges extra details (e.g. zod issues) without dropping fix_prompt', () => {
    const err = corruptBoardError({
      file: 'boards/x.json',
      problem: 'shape mismatch',
      details: { issues: [{ path: ['groups'] }] },
    });
    expect(err.details?.['issues']).toBeDefined();
    expect(err.details?.['fix_prompt']).toBeDefined();
  });
});

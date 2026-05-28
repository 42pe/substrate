import { describe, it, expect } from 'vitest';
import { getProjectHandler } from './get-project.js';
import type { ToolDeps } from '../../deps.js';
import type { Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 2,
  created_at: '2026-05-09T00:00:00.000Z',
};

const deps: ToolDeps = {
  client: {} as ToolDeps['client'],
  config: fixtureConfig,
  loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [] }),
};

describe('getProjectHandler', () => {
  it('returns the project record from config', () => {
    expect(getProjectHandler(deps)).toEqual({
      project_id: fixtureConfig.project_id,
      project_name: fixtureConfig.project_name,
      schema_version: fixtureConfig.schema_version,
      created_at: fixtureConfig.created_at,
    });
  });
});

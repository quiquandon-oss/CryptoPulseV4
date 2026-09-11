import { describe, it, expect } from 'vitest';
import { getDatabase } from '@/db/client';

describe('V1/V2/V3 Database Isolation Audit', () => {
  it('verifies V4 database is initialized in data/v4.db and isolated from legacy tables', () => {
    const db = getDatabase();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('market_candles');
    expect(tableNames).toContain('signals');
    expect(tableNames).toContain('signal_outcomes');
    expect(tableNames).toContain('system_health_logs');

    expect(tableNames).not.toContain('v1_predictions');
    expect(tableNames).not.toContain('v2_models');
    expect(tableNames).not.toContain('v3_scores');
  });
});

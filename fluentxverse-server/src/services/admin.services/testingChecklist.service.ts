import { db } from '../../db/postgres';
import { TESTING_RUN, testingChecklist, validateTestingUpdate, type TestingState } from '../../shared/testingChecklist';

let ready: Promise<void> | undefined;
async function ensureTables() {
  ready ??= (async () => {
    await db`CREATE TABLE IF NOT EXISTS admin_testing_checks (
      run_id TEXT NOT NULL, item_id TEXT NOT NULL, completed BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT, updated_at TIMESTAMPTZ, PRIMARY KEY (run_id, item_id)
    )`;
    await db`CREATE TABLE IF NOT EXISTS admin_testing_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id TEXT NOT NULL, item_id TEXT NOT NULL,
      completed BOOLEAN NOT NULL, notes TEXT NOT NULL, revision INTEGER NOT NULL,
      updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}

function state(row: any): TestingState {
  return { id: row.item_id, completed: row.completed, notes: row.notes, revision: row.revision,
    updatedBy: row.updated_by, updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null };
}

export const testingChecklistService = {
  async list() {
    await ensureTables();
    const rows = await db`SELECT * FROM admin_testing_checks WHERE run_id = ${TESTING_RUN}`;
    const states = new Map<string, TestingState>(rows.map((row: any) => [row.item_id, state(row)]));
    return testingChecklist.map(item => ({ ...item, ...(states.get(item.id) || {
      completed: false, notes: '', revision: 0, updatedBy: null, updatedAt: null,
    }) }));
  },
  async update(id: string, input: { completed: boolean; notes: string; revision: number }, actor: string) {
    const value = validateTestingUpdate(id, input);
    await ensureTables();
    return db.begin(async tx => {
      await tx`INSERT INTO admin_testing_checks (run_id, item_id) VALUES (${TESTING_RUN}, ${id}) ON CONFLICT DO NOTHING`;
      const [current] = await tx`SELECT revision FROM admin_testing_checks WHERE run_id = ${TESTING_RUN} AND item_id = ${id} FOR UPDATE`;
      if (current.revision !== value.revision) return null;
      const [row] = await tx`UPDATE admin_testing_checks SET completed = ${value.completed}, notes = ${value.notes},
        revision = revision + 1, updated_by = ${actor}, updated_at = NOW()
        WHERE run_id = ${TESTING_RUN} AND item_id = ${id} RETURNING *`;
      await tx`INSERT INTO admin_testing_audit (run_id, item_id, completed, notes, revision, updated_by)
        VALUES (${TESTING_RUN}, ${id}, ${row.completed}, ${row.notes}, ${row.revision}, ${actor})`;
      return state(row);
    });
  },
};

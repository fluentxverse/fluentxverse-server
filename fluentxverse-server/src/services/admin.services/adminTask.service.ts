import { db } from '../../db/postgres';

export type AdminTaskStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
export type AdminTaskKind = 'task' | 'suggestion';

let tableReady: Promise<unknown> | undefined;

const ensureTable = async () => {
  tableReady ??= (async () => {
    await db`CREATE TABLE IF NOT EXISTS admin_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('task', 'suggestion')),
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
      created_by VARCHAR(255) NOT NULL,
      assignee_id VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await db`ALTER TABLE admin_tasks ADD COLUMN IF NOT EXISTS assignee_id VARCHAR(255)`;
    await db`UPDATE admin_tasks SET assignee_id = created_by WHERE assignee_id IS NULL`;
  })().catch(error => {
    tableReady = undefined;
    throw error;
  });
  await tableReady;
};

export const adminTaskService = {
  async list() {
    await ensureTable();
    return db`SELECT * FROM admin_tasks ORDER BY created_at DESC`;
  },

  async create(title: string, description: string, kind: AdminTaskKind, createdBy: string, assigneeId: string) {
    await ensureTable();
    const rows = await db`
      INSERT INTO admin_tasks (title, description, kind, created_by, assignee_id)
      VALUES (${title}, ${description}, ${kind}, ${createdBy}, ${assigneeId})
      RETURNING *
    `;
    return rows[0];
  },

  async updateStatus(id: string, status: AdminTaskStatus, updatedBy: string) {
    await ensureTable();
    const rows = await db`
      UPDATE admin_tasks
      SET status = ${status}, updated_by = ${updatedBy}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `;
    return rows[0] ?? null;
  },

  async assign(id: string, assigneeId: string, updatedBy: string) {
    await ensureTable();
    const rows = await db`
      UPDATE admin_tasks
      SET assignee_id = ${assigneeId}, updated_by = ${updatedBy}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `;
    return rows[0] ?? null;
  },
};

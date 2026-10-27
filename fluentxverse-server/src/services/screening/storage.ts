import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { join, resolve } from 'node:path';
import { getDriver } from '../../db/memgraph';
import { decodeSubmittedAudio } from './evidence';

function encryptionKey(): Buffer {
  const key = process.env.SCREENING_EVIDENCE_KEY_HEX || '';
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Dedicated screening encryption key required');
  return Buffer.from(key, 'hex');
}

export function sealPrivateEvidence(value: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: encrypted.toString('base64') });
}

export function openPrivateEvidence(value: string, context: string): Buffer {
  const data = JSON.parse(value);
  if (data.version !== 1) throw new Error('Unsupported evidence encryption format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(data.iv, 'hex'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]);
}

export async function savePrivateAudio(audio: Buffer): Promise<string | null> {
  if (!process.env.SCREENING_EVIDENCE_KEY_HEX && process.env.SCREENING_ENABLED !== 'true') return null;
  const root = resolve(process.env.SCREENING_EVIDENCE_DIR || 'private-screening-evidence');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.audio`;
  await writeFile(join(root, name), sealPrivateEvidence(audio, name), { flag: 'wx', mode: 0o600 });
  return name;
}
export async function loadPrivateAudio(name: string): Promise<Buffer> {
  if (/^recording:[a-zA-Z0-9_-]{1,128}:\d{1,2}$/.test(name)) {
    const session = getDriver().session();
    try {
      const row = (await session.run('MATCH(e:Exam)-[:HAS_RECORDING]->(r:SpeakingRecording {id:$id}) RETURN e.id AS examId,r', { id: name.slice(10) })).records[0];
      if (!row) throw new Error('Private recording not found');
      const r = row.get('r').properties;
      const value = openPrivateEvidence(r.encryptedAudio, `oral:${r.tutorId}:${row.get('examId')}:${r.taskId}`);
      return decodeSubmittedAudio(JSON.parse(value.toString()).audioUrl);
    } finally { await session.close(); }
  }
  if (!/^[a-f0-9-]{36}\.audio$/.test(name)) throw new Error('Invalid private audio reference');
  const root = resolve(process.env.SCREENING_EVIDENCE_DIR || 'private-screening-evidence');
  return openPrivateEvidence(await readFile(join(root, name), 'utf8'), name);
}

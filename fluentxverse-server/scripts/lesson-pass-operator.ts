import { readFileSync, statSync } from 'node:fs';
const privateFile = (name: string) => {
  const path = process.env[name];
  if (!path || !statSync(path).isFile() || (statSync(path).mode & 0o077)) throw new Error(`${name} must point to a private mode-0600 file`);
  return readFileSync(path, 'utf8').trim();
};
const paths: Record<string,string> = { approve:'orders/:id/approve',seal:'batches/:id/seal',register:'batches/:id/register',
  submit:'reservations/:id/submit',certify:'reservations/:id/certify',reconcile:'reservations/:id/reconcile',finalize:'reservations/:id/finalize' };
const [action,id] = process.argv.slice(2);
try {
  if (!action || action !== 'queue' && (!paths[action] || !/^0x[a-f0-9]{64}$/.test(id || ''))) throw new Error('Usage: lesson-pass-operator.ts queue | approve/seal/register/submit/certify/reconcile/finalize <id>');
  const base = process.env.LESSON_PASS_OPERATOR_API || 'https://api.fluentxverse.com';
  const target = new URL(`/lesson-passes/admin/${action === 'queue' ? 'queue' : paths[action]!.replace(':id',id!)}`,base);
  if (target.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Remote operator API requires HTTPS');
  const cookie = privateFile('LESSON_PASS_OPERATOR_COOKIE_FILE');
  if (/[\r\n]/.test(cookie)) throw new Error('Cookie file must contain one header value');
  const body = ['approve','seal','certify'].includes(action) ? JSON.parse(privateFile('LESSON_PASS_OPERATOR_INPUT_FILE')) : {};
  const response = await fetch(target,{method:action === 'queue' ? 'GET' : 'POST',redirect:'error',
    headers:{Cookie:cookie,Origin:'https://dashboard.fluentxverse.com','Content-Type':'application/json'},
    body:action === 'queue' ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(310000)});
  const result = await response.json() as any;
  if (!response.ok || !result.success) throw new Error(`Operator request failed (${response.status}). Inspect its durable state before retrying.`);
  console.log(JSON.stringify(result.data,null,2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Operator request failed'); process.exitCode=1; }

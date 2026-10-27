export type WorkClass = 'general' | 'search' | 'auth' | 'privy' | 'upload' | 'assessment' | 'ai' | 'proof' | 'publicProof';
export interface WorkPolicy { category: WorkClass; maxBytes: number; roles?: readonly string[]; accountLimit: number; globalLimit: number }
const MiB = 1024 * 1024;

export function requestPolicy(path: string, method: string, contentType = ''): WorkPolicy {
  path = path.replace(/\/+$/, '') || '/';
  const general: WorkPolicy = { category: 'general', maxBytes: 10 * MiB, accountLimit: 1200, globalLimit: 6000 };
  if (method === 'GET' && path === '/tutor/search') return { category: 'search', maxBytes: 0, accountLimit: 300, globalLimit: 1200 };
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return general;
  if (/^\/tutor\/email-verification\/(send|confirm)$/.test(path)) return { category: 'auth', maxBytes: 4096, accountLimit: 30, globalLimit: 300 };
  if (/^\/student\/(?:auth\/privy|register\/privy)$/.test(path)) return { category: 'privy', maxBytes: 64 * 1024, accountLimit: 60, globalLimit: 300 };
  if (/^\/(?:(?:auth|tutor)\/(?:login|register)|admin\/login|student\/(?:login|register|auth\/wallet(?:\/nonce)?|register\/wallet))$/.test(path)) return { category: 'auth', maxBytes: 64 * 1024, accountLimit: 30, globalLimit: 300 };
  if ((path.startsWith('/screening/admin/') || path.startsWith('/anonymous-reviews/admin/') || path.startsWith('/lesson-passes/admin/')) && /\/(?:prove|submit|certify|request-validation)$/.test(path)) return { category: 'proof', maxBytes: 64 * 1024, roles: ['admin', 'superadmin'], accountLimit: 6, globalLimit: 12 };
  if (path.startsWith('/proof/')) return { category: 'proof', maxBytes: 64 * 1024, roles: ['student', 'tutor', 'admin', 'superadmin'], accountLimit: 6, globalLimit: 12 };
  if (/^\/(?:anonymous-reviews|lesson-passes)\/public\//.test(path)) return { category: 'publicProof', maxBytes: 32 * 1024, accountLimit: 30, globalLimit: 100 };
  if (path.startsWith('/ai/')) return { category: 'ai', maxBytes: 256 * 1024, roles: ['tutor', 'admin', 'superadmin'], accountLimit: 20, globalLimit: 60 };
  if (/^\/exam\/(?:speaking|written)\//.test(path)) return { category: 'assessment', maxBytes: path.endsWith('/recording') ? 9 * MiB : 64 * 1024, roles: ['tutor'], accountLimit: 20, globalLimit: 100 };
  if (path === '/tutor/intro-video') return { category: 'upload', maxBytes: 100 * MiB, roles: ['tutor'], accountLimit: 6, globalLimit: 20 };
  if (path === '/tutor/profile-picture') return { category: 'upload', maxBytes: 8 * MiB, roles: ['tutor'], accountLimit: 6, globalLimit: 20 };
  if (path === '/interview/recording') return { category: 'upload', maxBytes: 96 * MiB, roles: ['admin', 'superadmin'], accountLimit: 6, globalLimit: 20 };
  if (path.startsWith('/admin/mail/')) return { category: 'upload', maxBytes: 12 * MiB, roles: ['admin', 'superadmin'], accountLimit: 30, globalLimit: 60 };
  if (contentType.toLowerCase().startsWith('multipart/form-data')) return { category: 'upload', maxBytes: 10 * MiB, roles: path.startsWith('/lesson/') ? ['admin', 'superadmin'] : ['student', 'tutor', 'admin', 'superadmin'], accountLimit: 6, globalLimit: 20 };
  return general;
}

export function edgeProtected(path: string, method: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  return /^\/(?:ai|proof|screening\/admin|anonymous-reviews\/(?:admin|public)|lesson-passes\/(?:admin|public)|exam\/(?:speaking|written))\//.test(path)
    || /^\/(?:tutor\/(?:intro-video|profile-picture|login|register)|interview\/recording|auth\/(?:login|register)|admin\/login|student\/(?:login|register|auth\/(?:privy|wallet(?:\/nonce)?)|register\/(?:privy|wallet)))\/?$/.test(path);
}

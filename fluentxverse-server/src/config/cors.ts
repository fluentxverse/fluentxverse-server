const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
  'http://192.168.0.102:5173',
  'http://192.168.0.102:5174',
  'http://192.168.0.102:5175',
  'https://fluentxverse.com',
  'https://www.fluentxverse.com',
  'https://student.fluentxverse.com',
  'https://tutor.fluentxverse.com',
  'https://dashboard.fluentxverse.com',
  'https://fluentxverse.xyz',
  'https://student.fluentxverse.xyz',
  'https://tutor.fluentxverse.xyz',
  'https://dashboard.fluentxverse.xyz',
];

const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, '');

const PRODUCTION_STUDENT_ORIGINS = ['https://student.fluentxverse.com', 'https://student.fluentxverse.xyz'];
const LOCAL_STUDENT_ORIGINS = [
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

export const getAllowedOrigins = (
  envValue = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || ''
) => {
  const envOrigins = envValue
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);

  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins].map(normalizeOrigin))];
};

export const isAllowedOrigin = (
  origin: string | null | undefined,
  allowedOrigins = getAllowedOrigins()
) => {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  return allowedOrigins.some(allowedOrigin => normalizeOrigin(allowedOrigin) === normalizedOrigin);
};

export const isAllowedStudentOrigin = (origin: string | null | undefined) =>
  !origin || PRODUCTION_STUDENT_ORIGINS.includes(normalizeOrigin(origin))
  || (process.env.NODE_ENV !== 'production' && LOCAL_STUDENT_ORIGINS.includes(normalizeOrigin(origin)));

export const isAllowedStudentRequest = (origin: string | null, method: string) =>
  isAllowedStudentOrigin(origin)
  && (['GET', 'HEAD', 'OPTIONS'].includes(method) || Boolean(origin));

export const isAllowedAdminMutationOrigin = (origin: string | null) =>
  Boolean(origin && [
    'https://dashboard.fluentxverse.com',
    'https://dashboard.fluentxverse.xyz',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
  ].includes(origin));

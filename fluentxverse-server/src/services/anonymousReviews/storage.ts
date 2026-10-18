import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AnonymousReviewError } from './policy';
function key() {
  const value = process.env.ANONYMOUS_REVIEWS_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new AnonymousReviewError('Review storage key is missing', 503);
  return Buffer.from(value, 'hex');
}
export function encryptReview(content: unknown, id: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(content)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function decryptReview(encoded: string, id: string) {
  const bytes = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28)); decipher.setAAD(Buffer.from(id));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
}

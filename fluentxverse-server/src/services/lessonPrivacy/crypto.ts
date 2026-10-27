import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import type { SignedLessonEvidence } from '../../../../shared/lessonPrivacy';
import { LessonPrivacyError } from './policy';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export class LessonPrivacyCrypto {
  constructor(private encryption = process.env.LESSON_PRIVACY_ENCRYPTION_KEY || '', private signing = process.env.LESSON_PRIVACY_SIGNING_KEY || '') {}
  get encryptionEnabled() { return /^[a-f0-9]{64}$/i.test(this.encryption); }
  get evidenceEnabled() { try { return this.encryptionEnabled && this.privateKey().asymmetricKeyType === 'ed25519'; } catch { return false; } }
  private privateKey() {
    if (!this.signing) throw new LessonPrivacyError('Lesson evidence signing is not configured.', 503);
    const key = createPrivateKey({ key: Buffer.from(this.signing, 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new LessonPrivacyError('An Ed25519 signing key is required.', 503);
    return key;
  }
  seal(value: unknown, context: string) {
    if (!this.encryptionEnabled) throw new LessonPrivacyError('Private lesson encryption is not configured.', 503);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(this.encryption, 'hex'), iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(canonical(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  open<T>(value: string, context: string): T {
    if (!this.encryptionEnabled) throw new LessonPrivacyError('Private lesson encryption is not configured.', 503);
    const bytes = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.encryption, 'hex'), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  }
  issuer() {
    const publicKey = createPublicKey(this.privateKey()).export({ format: 'der', type: 'spki' }).toString('base64');
    return { algorithm: 'Ed25519' as const, publicKey, keyId: createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex') };
  }
  sign(payload: SignedLessonEvidence['payload']): SignedLessonEvidence {
    return { payload, ...this.issuer(), signature: sign(null, Buffer.from(canonical(payload)), this.privateKey()).toString('base64') };
  }
}
export function verifyLessonEvidence(envelope: SignedLessonEvidence, trustedPublicKey: string): boolean {
  try {
    if (envelope.algorithm !== 'Ed25519' || envelope.publicKey !== trustedPublicKey || envelope.payload.schema !== 'fluentxverse.lesson-evidence.v1') return false;
    const keyId = createHash('sha256').update(Buffer.from(trustedPublicKey, 'base64')).digest('hex');
    if (envelope.keyId !== keyId) return false;
    return verify(null, Buffer.from(canonical(envelope.payload)), createPublicKey({ key: Buffer.from(trustedPublicKey, 'base64'), type: 'spki', format: 'der' }), Buffer.from(envelope.signature, 'base64'));
  } catch { return false; }
}

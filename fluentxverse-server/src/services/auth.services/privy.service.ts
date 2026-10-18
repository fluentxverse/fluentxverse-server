import { PrivyClient, type LinkedAccount, type User } from '@privy-io/node';

export type PrivySocialProvider = 'google' | 'twitter' | 'apple';

export interface VerifiedPrivyIdentity {
  privyUserId: string;
  provider: PrivySocialProvider;
  email?: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
}

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  const appId = process.env.PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new Error('Privy authentication is not configured');
  }

  privyClient ??= new PrivyClient({ appId, appSecret });
  return privyClient;
}

function splitName(name?: string | null): { givenName?: string; familyName?: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return {};
  if (parts.length === 1) return { givenName: parts[0] };
  return {
    givenName: parts.slice(0, -1).join(' '),
    familyName: parts.at(-1),
  };
}

function getSocialIdentity(user: User): Omit<VerifiedPrivyIdentity, 'privyUserId'> {
  const socialAccount = user.linked_accounts.find((account: LinkedAccount) =>
    account.type === 'google_oauth' ||
    account.type === 'twitter_oauth' ||
    account.type === 'apple_oauth'
  );

  if (!socialAccount) {
    throw new Error('A Google, X, or Apple account is required');
  }

  if (socialAccount.type === 'google_oauth') {
    return {
      provider: 'google',
      email: socialAccount.email.trim().toLowerCase(),
      emailVerified: true,
      ...splitName(socialAccount.name),
    };
  }

  if (socialAccount.type === 'apple_oauth') {
    return {
      provider: 'apple',
      email: socialAccount.email?.trim().toLowerCase() || undefined,
      emailVerified: Boolean(socialAccount.email),
    };
  }

  return {
    provider: 'twitter',
    emailVerified: false,
    ...splitName(socialAccount.name || socialAccount.username),
  };
}

export async function verifyPrivySession(
  accessToken: string,
): Promise<VerifiedPrivyIdentity> {
  const client = getPrivyClient();
  const claims = await client.utils().auth().verifyAccessToken(accessToken);
  const user = await client.users()._get(claims.user_id);

  return {
    privyUserId: user.id,
    ...getSocialIdentity(user),
  };
}

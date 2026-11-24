export function identityIssuanceMode(): 'pilot' | 'production' {
  const mode = process.env.TUTOR_IDENTITY_ISSUANCE_MODE || 'pilot';
  if (mode !== 'pilot' && mode !== 'production') throw Error('Invalid identity issuance mode');
  return mode;
}
export const identityWalletConsentVersion = (mode: 'pilot' | 'production') =>
  mode === 'production' ? 'tutor-identity-wallet.arbitrum-mainnet.v1' : 'tutor-identity-wallet.v1';

export class ProfileCredentialRequired extends Error {}
export function assertProfileCredentialConsent(user:Record<string,any>,identity:Record<string,any>|undefined) {
  const w=user.smartWalletAddress,holder=w&&typeof w==='object'?(w.smartAccountAddress||w.address):null;
  if(!identity || identity.id!==user.identitySubmissionId || identity.status!=='verified' || user.identityVerified!==true
    || user.identityBanned===true || identity.walletPublicationConsent!==true
    || identity.walletConsentVersion!==identityWalletConsentVersion('production') || typeof holder!=='string'
    || !/^0x[\da-fA-F]{40}$/.test(holder) || BigInt(holder)===0n || w.userId!==user.id || identity.walletConsentAddress!==holder.toLowerCase())
    throw new ProfileCredentialRequired('Confirm your tutor credential in Interview > Identity verification before submitting your profile.');
}

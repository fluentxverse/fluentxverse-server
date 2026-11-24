import { getDriver } from '../../db/memgraph';
import { identityMetadataUri, publicProductionIdentityMetadata } from './metadata';

// This projection deliberately excludes issuanceJson (which contains private
// proving material) and all identity documents and applicant personal details.
export function adminCredentialSummary(entry: any, currentSubmissionId: string | null) {
  const job = entry.issuanceJson ? JSON.parse(entry.issuanceJson) : null;
  return {
    submissionId: entry.id,
    current: entry.id === currentSubmissionId,
    revoked: entry.revoked === true,
    status: entry.revoked ? 'invalidated' : entry.credentialDisplayStatus || entry.issuanceStage || entry.status,
    chainId: job?.binding?.chainId ?? null,
    wallet: job?.binding?.holder ?? null,
    collection: job?.binding?.collection ?? null,
    tokenId: job?.tokenId ?? null,
    mintTransactionHash: entry.mintTransactionHash || null,
    proofTransactionHash: job?.nativeProofTransactionHash || null,
    metadataUrl: null as string | null,
    issuerStatus: null as string | null,
  };
}

export async function adminIdentityCredentials(tutorId: string, currentSubmissionId: string | null) {
  const session = getDriver().session();
  try {
    const rows = (await session.run(`MATCH(j:TutorIdentityCredential {tutorId:$tutorId})
      RETURN j ORDER BY j.createdAt DESC LIMIT 20`, { tutorId })).records;
    return await Promise.all(rows.map(async row => {
      const entry = row.get('j').properties;
      const result = adminCredentialSummary(entry, currentSubmissionId);
      if (entry.issuanceStage === 'issued' && result.chainId === 42161 && result.collection && result.tokenId) {
        const tokenHex = BigInt(result.tokenId).toString(16).padStart(64, '0');
        const json = await publicProductionIdentityMetadata(result.collection, `${tokenHex}.json`);
        if (json) {
          result.metadataUrl = identityMetadataUri(JSON.parse(entry.issuanceJson));
          result.issuerStatus = JSON.parse(json).properties.issuerStatus;
        }
      }
      return result;
    }));
  } finally { await session.close(); }
}

// Project only profile fields; never transfer password hashes, screening answers or other account records.
export const tutorProfileQuery = `
  MATCH (u:User {id: $tutorId})
  OPTIONAL MATCH (u)-[:HAS_CERTIFICATION_CREDENTIAL]->(cred:TutorCertificationCredential)
  RETURN u {
    .id, .email, .firstName, .middleName, .lastName, .displayName, .profilePicture,
    .bio, .introduction, .tier, .timezone, .country, .languages, .specializations,
    .interests, .hourlyRate, .experienceYears, .education, .certifications,
    .schoolAttended, .major, .teachingQualifications, .teachingStyle, .videoIntroUrl,
    .rating, .totalReviews, .totalSessions, .isVerified, .isAvailable, .createdAt,
    .profileStatus, .profileSubmittedAt, .profileItemStatuses, .profileRejectionReason,
    .pendingProfileChanges, .hasPendingChanges
  } AS u, cred {
    .status, .credentialCommitment, .circuitVersion, .zkVerifyVerifiedAt, .verifiedAt, .zkVerifyTxHash
  } AS cred
`;

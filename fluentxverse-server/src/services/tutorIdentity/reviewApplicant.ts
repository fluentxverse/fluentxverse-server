// Explicit allowlist for the authenticated reviewer response. Never used by proof/metadata generation.
export function identityReviewApplicant(u: Record<string,unknown>) {
  const text=(v:unknown)=>typeof v==='string'?v.trim():'';
  const raw=text(u.birthDate),date=raw.slice(0,10);
  const birthDate=/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0,10)===date?date:'';
  return {
    fullName:[u.firstName,u.middleName,u.lastName,u.suffix].map(text).filter(Boolean).join(' '),
    birthDate,
    address:[u.addressLine,u.cityName,u.provinceName,u.regionName,u.zipCode,u.country].map(text).filter(Boolean).join(', '),
  };
}

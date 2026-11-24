export const PROFILE_REVIEW_ITEMS = ['nickname','profilePicture','videoIntro','bio','education','interests'] as const;
export function profileReviewProgress(statuses: unknown) {
  let parsed: any = statuses;
  if(typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = {}; } }
  const approved = PROFILE_REVIEW_ITEMS.filter(key => parsed?.[key]?.status === 'approved').length;
  return {approved,total:PROFILE_REVIEW_ITEMS.length,percent:Math.round(approved / PROFILE_REVIEW_ITEMS.length * 100),allApproved:approved === PROFILE_REVIEW_ITEMS.length};
}
export function shouldSubmitProfile(status: string | undefined) {
  return status !== 'approved' && status !== 'pending_review';
}
export const PROFILE_REVIEW_FIELDS: Record<string,string> = {
  nickname:'nickname',bio:'bio',profilePicture:'profilePicture',videoIntroUrl:'videoIntro',
  schoolAttended:'education',major:'education',educationalAttainment:'education',teachingExperience:'education',teachingQualifications:'education',interests:'interests',
};

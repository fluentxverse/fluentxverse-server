import {test,expect} from 'bun:test';
import {PROFILE_REVIEW_ITEMS,profileReviewProgress,shouldSubmitProfile,PROFILE_REVIEW_FIELDS} from '../../shared/profileReview';
test('only six required review items count toward approval, regardless of legacy extra keys',()=>{
 const approved=Object.fromEntries(PROFILE_REVIEW_ITEMS.map(k=>[k,{status:'approved'}]));
 expect(profileReviewProgress({...approved,legacy:{status:'approved'}})).toEqual({approved:6,total:6,percent:100,allApproved:true});
 expect(profileReviewProgress({...approved,nickname:{status:'pending'},legacy:{status:'approved'}}).allApproved).toBe(false);
 expect(profileReviewProgress({...approved,bio:{status:'rejected'}}).approved).toBe(5);
 expect(profileReviewProgress('malformed').approved).toBe(0);
 expect(profileReviewProgress(JSON.stringify(approved)).allApproved).toBe(true);
});
test('resubmitting approved or already-pending profiles cannot downgrade approval or duplicate submission',()=>{
 expect(shouldSubmitProfile('approved')).toBe(false);
 expect(shouldSubmitProfile('pending_review')).toBe(false);
 expect(shouldSubmitProfile('rejected')).toBe(true);
 expect(shouldSubmitProfile('incomplete')).toBe(true);
 for(const field of ['bio','profilePicture','interests','nickname','videoIntroUrl','schoolAttended','major','teachingQualifications'])expect(PROFILE_REVIEW_ITEMS.some(key=>key===PROFILE_REVIEW_FIELDS[field])).toBe(true);
});

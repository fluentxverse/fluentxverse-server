import {test,expect} from 'bun:test';
import {identityReviewApplicant} from '../src/services/tutorIdentity/reviewApplicant';
test('review details use full on-file identity fields and allowlist private account data',()=>{
  const result=identityReviewApplicant({firstName:' Test ',middleName:'Middle',lastName:'Applicant',suffix:'Jr.',birthDate:'2000-02-29',
    addressLine:'12 Test Street',cityName:'Test City',provinceName:'Test Province',regionName:'Test Region',zipCode:'1234',country:'Philippines',password:'secret',idNumber:'hidden'});
  expect(result).toEqual({fullName:'Test Middle Applicant Jr.',birthDate:'2000-02-29',address:'12 Test Street, Test City, Test Province, Test Region, 1234, Philippines'});
  expect(JSON.stringify(result)).not.toContain('secret');expect(JSON.stringify(result)).not.toContain('hidden');
});
test('missing details are not fabricated and malformed birth dates are not presented as valid',()=>{
  expect(identityReviewApplicant({})).toEqual({fullName:'',birthDate:'',address:''});
  expect(identityReviewApplicant({birthDate:'2001-02-29'}).birthDate).toBe('');
  expect(identityReviewApplicant({birthDate:'2000-01-01T00:00:00Z'}).birthDate).toBe('2000-01-01');
});

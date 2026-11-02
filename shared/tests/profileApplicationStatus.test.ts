import { test, expect } from 'bun:test';
import { profileApplicationStatus } from '../profileApplicationStatus';
test('profile submission and staff decision remain separate', () => {
  expect(profileApplicationStatus('incomplete')).toMatchObject({ submission: 'Not submitted', review: 'Not started' });
  expect(profileApplicationStatus('pending_review')).toMatchObject({ submission: 'Submitted', review: 'Pending review' });
  expect(profileApplicationStatus('approved')).toMatchObject({ submission: 'Submitted', review: 'Approved' });
  expect(profileApplicationStatus('rejected')).toMatchObject({ submission: 'Submitted', review: 'Rejected' });
  expect(profileApplicationStatus('unknown')).toMatchObject({ submission: 'Unknown', review: 'Unknown' });
});

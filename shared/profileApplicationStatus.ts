export function profileApplicationStatus(status: string) {
  switch (status) {
    case 'incomplete': return { submission: 'Not submitted', review: 'Not started', tone: 'neutral' };
    case 'pending_review': return { submission: 'Submitted', review: 'Pending review', tone: 'pending' };
    case 'approved': return { submission: 'Submitted', review: 'Approved', tone: 'approved' };
    case 'rejected': return { submission: 'Submitted', review: 'Rejected', tone: 'rejected' };
    default: return { submission: 'Unknown', review: 'Unknown', tone: 'neutral' };
  }
}

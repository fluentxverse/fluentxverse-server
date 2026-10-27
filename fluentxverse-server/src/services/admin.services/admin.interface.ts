export interface DashboardStats {
  totalTutors: number;
  certifiedTutors: number;
  pendingTutors: number;
  totalStudents: number;
  totalSessions: number;
  totalRevenue: number;
}

export interface ExamStats {
  writtenExams: {
    total: number;
    passed: number;
    failed: number;
  };
  speakingExams: {
    total: number;
    passed: number;
    failed: number;
    processing: number;
  };
}

export interface RecentActivity {
  id: string;
  type: 'tutor_registered' | 'exam_passed' | 'exam_failed' | 'student_joined' | 'booking' | 'profile_submitted';
  message: string;
  timestamp: string | null;
  userId?: string;
}

export interface PendingTutor {
  id: string;
  name: string;
  email: string;
  registeredAt: string;
  status: 'pending_written' | 'pending_speaking' | 'processing';
  writtenExamPassed: boolean;
  speakingExamPassed: boolean;
  interviewResult?: 'pass' | 'fail' | null;
  interviewDate?: string | null;
}

export interface ProfileItemStatus {
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  reviewedAt?: string;
}

export interface ProfileItemStatuses {
  profilePicture: ProfileItemStatus;
  videoIntro: ProfileItemStatus;
  bio: ProfileItemStatus;
  education: ProfileItemStatus;
  interests: ProfileItemStatus;
}

// Pending changes for already-approved profiles
export interface PendingProfileChange {
  itemKey: 'profilePicture' | 'videoIntro' | 'bio' | 'education' | 'interests';
  newValue: any;
  oldValue?: any;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export interface PendingProfileReview {
  id: string;
  name: string;
  email: string;
  profilePicture?: string;
  bio?: string;
  videoIntroUrl?: string;
  schoolAttended?: string;
  major?: string;
  interests?: string[];
  submittedAt: string;
  profileStatus: 'pending_review' | 'approved' | 'rejected';
  profileItemStatuses?: ProfileItemStatuses;
  // For approved profiles with pending changes
  pendingChanges?: PendingProfileChange[];
  isInitialReview?: boolean; // true for first-time review, false for change review
}

export interface TutorListItem {
  id: string;
  name: string;
  email: string;
  profilePicture?: string;
  isBlocked: boolean;
  blockExpiresAt?: string;
  penaltyBlockOverrideUntil?: string;
  registeredAt: string;
  writtenExamPassed: boolean;
  speakingExamPassed: boolean;
  interviewPassed: boolean;
  writtenExamScore?: number;
  speakingExamScore?: number;
  status: 'pending' | 'certified' | 'processing' | 'failed' | 'pending_profile' | 'test_qualified';
  profileStatus?: 'incomplete' | 'pending_review' | 'approved' | 'rejected';
  zkCertificationStatus?: 'requirements_incomplete' | 'ready_for_proving' | 'local_proof_generated' | 'submitted' | 'verified' | 'failed' | 'retired' | 'expired' | 'revoked';
  zkCredentialCommitment?: string;
  zkVerifyTxHash?: string;
  zkVerifyAggregationId?: number;
  zkVerifyDomainId?: string;
  zkVerifyLastError?: string;
  zkVerifyUpdatedAt?: string;
  languages: string[];
  totalSessions: number;
  rating: number;
  // Suspension fields
  isSuspended: boolean;
  suspendedUntil?: string;
  suspendedReason?: string;
  suspendedAt?: string;
}

export interface StudentListItem {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
  totalSessions: number;
  totalSpent: number;
  status: 'active' | 'inactive';
  lastActive: string;
  // Suspension fields
  isSuspended: boolean;
  suspendedUntil?: string;
  suspendedReason?: string;
  suspendedAt?: string;
}

// Admin Auth Types
export interface AdminUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  role: 'admin' | 'superadmin';
  createdAt: string;
}

export interface AdminLoginParams {
  username: string;
  password: string;
}

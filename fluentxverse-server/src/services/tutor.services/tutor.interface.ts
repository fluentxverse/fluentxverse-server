// Tutor-related types and interfaces for backend

export interface Tutor {
  userId: string;
  email: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  displayName: string;
  profilePicture?: string;
  bio?: string;
  tier: number;
  hourlyRate?: number;
  languages?: string[];
  specializations?: string[];
  totalSessions?: number;
  rating?: number;
  totalReviews?: number;
  isAvailable?: boolean;
  nextAvailableSlot?: string;
  country?: string;
  timezone?: string;
  isVerified?: boolean;
  joinedDate?: string;
  zkCertificationStatus?: string;
  zkCredentialCommitment?: string;
  zkCircuitVersion?: string;
  zkVerifiedAt?: string;
  zkVerifyTxHash?: string;
}

export interface TutorProfile extends Tutor {
  education?: string[];
  certifications?: string[];
  experienceYears?: number;
  teachingStyle?: string;
  introduction?: string;
  videoIntroUrl?: string;
  interests?: string[];
  schoolAttended?: string;
  major?: string;
  completionRate?: number;
  responseTime?: string;
  repeatStudents?: number;
  profileStatus?: 'incomplete' | 'pending_review' | 'approved' | 'rejected';
  profileSubmittedAt?: string;
  currentProficiency?: string;
  teachingQualifications?: string[];
  lessonPreferences?: {
    preferCameraOn?: boolean;
    errorCorrection?: string;
    otherRequests?: string;
  };
  profileItemStatuses?: Record<string, string>;
  profileRejectionReason?: string;
  pendingProfileChanges?: any[];
  hasPendingChanges?: boolean;
}

export interface TutorFilters {
  languages?: string[];
  specializations?: string[];
  minRating?: number;
  maxHourlyRate?: number;
  minHourlyRate?: number;
  isAvailable?: boolean;
  sortBy?: 'rating' | 'price-low' | 'price-high' | 'popular' | 'newest';
}

export interface TutorSearchParams extends TutorFilters {
  query?: string;
  dateFilter?: string; // YYYY-MM-DD format to filter tutors with open slots on this date
  startTime?: string; // HH:MM format to filter slots starting from this time
  endTime?: string; // HH:MM format to filter slots ending before this time
  page?: number;
  limit?: number;
}

export interface TutorSearchResponse {
  tutors: Tutor[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

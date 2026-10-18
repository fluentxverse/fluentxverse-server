import type { Static } from '@sinclair/typebox'
import { UserSchema, MeSchema } from './auth.schema'

export interface RegisterParams {
    email: string;
    password: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    suffix?: string;
    birthDate: string;
    mobileNumber: string;
}


export interface RegisterStudentParams {
    email: string;
    password: string;
    familyName: string;
    givenName: string;
    birthDate: string;
    mobileNumber: string;
}

// Keep User type in-sync with schema at compile time
export type User = Static<typeof UserSchema>

export interface RegisteredParams extends RegisterParams {
    tier: number;
    role: string;
    signUpdate: number;
    smartWalletAddress: {
        address: string;
        createdAt: string;
        label: string;
        smartAccountAddress: string;
    }
    verifiedEmail: boolean;
    verifiedMobile: boolean;
    id: string;
}


export interface LoginReturnParams extends Omit<RegisteredParams, 'smartWalletAddress' | 'password'> {
    walletAddress: string;
}

export interface Suspended {
    until: Date | null;
    reason: string;
}

export interface LoginParams {
    email: string;
    password: string;
}


export type MeResponse = Static<(typeof MeSchema)["response"][200]>


export interface AuthData {
    userId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    walletAddress?: string;
    mobileNumber?: string;
    familyName?: string;
    givenName?: string;
    role?: string;
    tier: number;
}

// Personal info update params
export interface UpdatePersonalInfoParams {
    userId: string;
    phoneNumber?: string;
    // Address
    country?: string;
    region?: string;
    regionName?: string;
    province?: string;
    provinceName?: string;
    city?: string;
    cityName?: string;
    zipCode?: string;
    addressLine?: string;
    sameAsPermanent?: boolean;
    // Tutor Qualifications
    schoolAttended?: string;
    educationalAttainment?: string;
    major?: string;
    teachingExperience?: string;
    teachingQualifications?: string[];
    // Student Learning Preferences
    currentProficiency?: string;
    learningGoals?: string[];
    preferredLearningStyle?: string;
    availability?: string[];
}

// Update email params
export interface UpdateEmailParams {
    userId: string;
    newEmail: string;
    currentPassword: string;
}

// Update password params
export interface UpdatePasswordParams {
    userId: string;
    currentPassword: string;
    newPassword: string;
}

// Student user data returned from database
export interface StudentUserData {
    id: string;
    email: string | null;
    role: string;
    familyName: string | null;
    givenName: string | null;
    birthDate: string | null;
    mobileNumber: string | null;
    signUpdate: number;
    tier: number;
    verifiedEmail: boolean;
    verifiedMobile: boolean;
    externalWalletAddress?: string | null;
    smartWalletAddress?: string | { address: string } | null;
    suspendedUntil?: Date | null;
    suspendedReason?: string;
}

// Normalized user for frontend response
export interface NormalizedStudentUser {
    id: string;
    userId: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
    mobileNumber: string | null;
    tier: number;
    role: string;
    walletAddress: string | null;
}
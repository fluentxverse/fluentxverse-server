import { nanoid } from "nanoid";
import { hash, compare } from "bcrypt-ts";
import { getDriver } from "../../db/memgraph";
import type { RegisterParams, LoginParams, RegisteredParams, Suspended, RegisterStudentParams, UpdatePersonalInfoParams, UpdateEmailParams, UpdatePasswordParams } from "./auth.interface";
import { invalidateUserTokens } from '../../db/redis';
import WalletService from "../wallet.services/wallet.service";
import type { VerifiedPrivyIdentity } from "./privy.service";
import { buildLevelAssessment } from '../assessmentProfile';

class StudentService {
  public async loginByPrivy(identity: VerifiedPrivyIdentity): Promise<any | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `MATCH (s:Student)
         WHERE s.privyUserId = $privyUserId
            OR ($canMatchEmail = true AND toLower(s.email) = $email)
         SET s.privyUserId = $privyUserId,
             s.authProvider = $provider,
             s.verifiedEmail = CASE WHEN $emailVerified THEN true ELSE s.verifiedEmail END
         RETURN s
         LIMIT 1`,
        {
          privyUserId: identity.privyUserId,
          provider: identity.provider,
          email: identity.email || '',
          emailVerified: identity.emailVerified,
          canMatchEmail: Boolean(identity.email && identity.emailVerified),
        },
      );

      if (result.records.length === 0) return null;

      const user = result.records[0]?.get('s').properties;
      if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
        throw new Error(`Your account is suspended until ${new Date(user.suspendedUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. Reason: ${user.suspendedReason || 'Not specified'}`);
      }

      const { password, tier, ...safeProperties } = user;
      return { ...safeProperties, tier: Number(tier) || 0 };
    } finally {
      await session.close();
    }
  }

  public async registerByPrivy(params: {
    identity: VerifiedPrivyIdentity;
    email: string;
    familyName: string;
    givenName: string;
    birthDate: string;
    mobileNumber: string;
  }): Promise<any> {
    const { identity } = params;
    const email = (identity.emailVerified && identity.email ? identity.email : params.email).trim().toLowerCase();
    const id = nanoid(12);
    const signUpdate = Date.now();
    const driver = getDriver();
    const session = driver.session();

    try {
      const existing = await session.run(
        `MATCH (account)
         WHERE (account:Student OR account:User)
           AND (account.privyUserId = $privyUserId OR toLower(account.email) = $email)
         RETURN account LIMIT 1`,
        { privyUserId: identity.privyUserId, email },
      );
      if (existing.records.length > 0) {
        const error: any = new Error('EMAIL_EXISTS');
        error.code = 'EMAIL_EXISTS';
        throw error;
      }

      const walletService = new WalletService();
      const [encrypted, smartWalletAddress] = await Promise.all([
        hash(nanoid(48), 10),
        walletService.createServerWallet(id),
      ]);

      const result = await session.run(
        `CREATE (s:Student {
          id: $id,
          email: $email,
          password: $encrypted,
          role: 'student',
          familyName: $familyName,
          givenName: $givenName,
          birthDate: $birthDate,
          mobileNumber: $mobileNumber,
          signUpdate: $signUpdate,
          registeredAt: $signUpdate,
          suspendedUntil: null,
          suspendedReason: '',
          smartWalletAddress: $smartWalletAddress,
          privyUserId: $privyUserId,
          authProvider: $provider,
          verifiedEmail: $verifiedEmail,
          verifiedMobile: false
        })
        RETURN s`,
        {
          id,
          email,
          encrypted,
          familyName: params.familyName,
          givenName: params.givenName,
          birthDate: params.birthDate,
          mobileNumber: params.mobileNumber,
          signUpdate,
          smartWalletAddress,
          privyUserId: identity.privyUserId,
          provider: identity.provider,
          verifiedEmail: identity.emailVerified,
        },
      );

      const user = result.records[0]?.get('s').properties;
      const { password, tier, ...safeProperties } = user;
      return { ...safeProperties, tier: Number(tier) || 0 };
    } finally {
      await session.close();
    }
  }

  public async register(params: RegisterStudentParams & { familyName: string; givenName: string }): Promise<{ message: string }> {
    try {
      const id = nanoid(12);
      const signUpdate = Date.now();
      const suspended: Suspended = { until: null, reason: "" };
      const { email, password, familyName, givenName, birthDate, mobileNumber } = params;

      const walletService = new WalletService();
      const [encrypted, smartWalletAddress] = await Promise.all([
          hash(password, 10), // Reduced salt rounds for performance
          walletService.createServerWallet(id)
      ]);
      const driver = getDriver();
      const session = driver.session();

      // Check if email already exists in Student nodes
      const studentExistsResult = await session.run(
        `MATCH (s:Student { email: $email }) RETURN s LIMIT 1`,
        { email }
      );
      if (studentExistsResult.records.length > 0) {
        await session.close();
        const err: any = new Error('EMAIL_EXISTS');
        err.code = 'EMAIL_EXISTS';
        throw err;
      }

      // Check if email already exists in User (tutor) nodes
      const tutorExistsResult = await session.run(
        `MATCH (u:User { email: $email }) RETURN u LIMIT 1`,
        { email }
      );
      if (tutorExistsResult.records.length > 0) {
        await session.close();
        const err: any = new Error('EMAIL_EXISTS');
        err.code = 'EMAIL_EXISTS';
        throw err;
      }

      await session.run(
        `CREATE (s:Student {
          id: $id,
          email: $email,
          password: $encrypted,
          role: 'student',
          familyName: $familyName,
          givenName: $givenName,
          birthDate: $birthDate,
          mobileNumber: $mobileNumber,
          signUpdate: $signUpdate,
          registeredAt: $signUpdate,
          suspendedUntil: $suspendedUntil,
          suspendedReason: $suspendedReason,
          smartWalletAddress: $smartWalletAddress,
          verifiedEmail: false,
          verifiedMobile: false
        })`,
        {
          id,
          email,
          encrypted,
          familyName,
          givenName,
          birthDate,
          mobileNumber,
          signUpdate,
          suspendedUntil: suspended.until,
          suspendedReason: suspended.reason,
          smartWalletAddress
        }
      );
      await session.close();
      return { message: "Registration successful" };
    } catch (error: any) {
      console.error("Student registration error:", error);
      throw error;
    }
  }

  public async login(params: LoginParams): Promise<any> {
    try {
      const driver = getDriver();
      const session = driver.session();
      const result = await session.run(
        `MATCH (s:Student { email: $email }) RETURN s`,
        { email: params.email }
      );
      await session.close();
      if (result.records.length === 0) {
        throw new Error("Invalid email or password");
      }
      const user = result.records[0]?.get("s").properties;
      
      // Check if user is suspended
      if (user.suspendedUntil) {
        const suspendedUntil = new Date(user.suspendedUntil);
        if (suspendedUntil > new Date()) {
          const formattedDate = suspendedUntil.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          throw new Error(`Your account is suspended until ${formattedDate}. Reason: ${user.suspendedReason || 'Not specified'}`);
        }
      }
      
      const encryptedPassword: string = user.password;
      const isPasswordValid = await compare(params.password, encryptedPassword);
      if (!isPasswordValid) {
        throw new Error("Invalid email or password");
      }
      const { password, tier, ...safeProperties } = user;
      const tierNumber = Number(tier);
      return {
        ...safeProperties,
        tier: tierNumber
      };
    } catch (error: any) {
      console.error("Student login error:", error);
      throw error;
    }
  }

  public async updatePersonalInfo(params: UpdatePersonalInfoParams): Promise<{ message: string }> {
    try {
      const driver = getDriver();
      const session = driver.session();

      const {
        userId,
        phoneNumber,
        country,
        region,
        regionName,
        province,
        provinceName,
        city,
        cityName,
        zipCode,
        addressLine,
        sameAsPermanent,
        schoolAttended,
        educationalAttainment,
        major,
        teachingExperience,
        teachingQualifications,
        currentProficiency,
        learningGoals,
        preferredLearningStyle,
        availability
      } = params;

      // Build dynamic SET clause for only provided fields
      const updates: string[] = [];
      const queryParams: Record<string, any> = { userId };

      if (phoneNumber !== undefined) {
        updates.push('s.mobileNumber = $phoneNumber');
        queryParams.phoneNumber = phoneNumber;
      }
      if (country !== undefined) {
        updates.push('s.country = $country');
        queryParams.country = country;
      }
      if (region !== undefined) {
        updates.push('s.region = $region');
        queryParams.region = region;
      }
      if (regionName !== undefined) {
        updates.push('s.regionName = $regionName');
        queryParams.regionName = regionName;
      }
      if (province !== undefined) {
        updates.push('s.province = $province');
        queryParams.province = province;
      }
      if (provinceName !== undefined) {
        updates.push('s.provinceName = $provinceName');
        queryParams.provinceName = provinceName;
      }
      if (city !== undefined) {
        updates.push('s.city = $city');
        queryParams.city = city;
      }
      if (cityName !== undefined) {
        updates.push('s.cityName = $cityName');
        queryParams.cityName = cityName;
      }
      if (zipCode !== undefined) {
        updates.push('s.zipCode = $zipCode');
        queryParams.zipCode = zipCode;
      }
      if (addressLine !== undefined) {
        updates.push('s.addressLine = $addressLine');
        queryParams.addressLine = addressLine;
      }
      if (sameAsPermanent !== undefined) {
        updates.push('s.sameAsPermanent = $sameAsPermanent');
        queryParams.sameAsPermanent = sameAsPermanent;
      }
      if (schoolAttended !== undefined) {
        updates.push('s.schoolAttended = $schoolAttended');
        queryParams.schoolAttended = schoolAttended;
      }
      if (educationalAttainment !== undefined) {
        updates.push('s.educationalAttainment = $educationalAttainment');
        queryParams.educationalAttainment = educationalAttainment;
      }
      if (major !== undefined) {
        updates.push('s.major = $major');
        queryParams.major = major;
      }
      if (teachingExperience !== undefined) {
        updates.push('s.teachingExperience = $teachingExperience');
        queryParams.teachingExperience = teachingExperience;
      }
      if (teachingQualifications !== undefined) {
        updates.push('s.teachingQualifications = $teachingQualifications');
        queryParams.teachingQualifications = teachingQualifications;
      }
      if (currentProficiency !== undefined) {
        updates.push('s.currentProficiency = $currentProficiency');
        queryParams.currentProficiency = currentProficiency;
      }
      if (learningGoals !== undefined) {
        updates.push('s.learningGoals = $learningGoals');
        queryParams.learningGoals = learningGoals;
      }
      if (preferredLearningStyle !== undefined) {
        updates.push('s.preferredLearningStyle = $preferredLearningStyle');
        queryParams.preferredLearningStyle = preferredLearningStyle;
      }
      if (availability !== undefined) {
        updates.push('s.availability = $availability');
        queryParams.availability = availability;
      }

      if (updates.length === 0) {
        return { message: 'No fields to update' };
      }

      await session.run(
        `
        MATCH (s:Student { id: $userId })
        SET ${updates.join(', ')}
        `,
        queryParams
      );

      await session.close();
      return { message: 'Personal information updated successfully' };
    } catch (error: any) {
      console.error('Update personal info error:', error);
      throw error;
    }
  }

  public async updateEmail(params: UpdateEmailParams): Promise<{ message: string }> {
    try {
      const driver = getDriver();
      const session = driver.session();

      const { userId, newEmail, currentPassword } = params;

      // First, verify the current password
      const studentResult = await session.run(
        `
        MATCH (s:Student { id: $userId })
        RETURN s.password as password, s.email as currentEmail
        `,
        { userId }
      );

      if (studentResult.records.length === 0) {
        await session.close();
        throw new Error('Student not found');
      }

      const encryptedPassword = studentResult.records[0]?.get('password');
      const currentEmail = studentResult.records[0]?.get('currentEmail');
      
      const isPasswordValid = await compare(currentPassword, encryptedPassword);
      if (!isPasswordValid) {
        await session.close();
        throw new Error('Current password is incorrect');
      }

      // Check if new email is the same as current
      if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
        await session.close();
        throw new Error('New email must be different from current email');
      }

      // Check if the new email is already in use
      const emailCheck = await session.run(
        `
        MATCH (s:Student { email: $newEmail })
        RETURN s
        `,
        { newEmail: newEmail.toLowerCase() }
      );

      if (emailCheck.records.length > 0) {
        await session.close();
        throw new Error('Email is already in use');
      }

      // Update the email
      await session.run(
        `
        MATCH (s:Student { id: $userId })
        SET s.email = $newEmail, s.verifiedEmail = false
        `,
        { userId, newEmail: newEmail.toLowerCase() }
      );

      await session.close();
      return { message: 'Email updated successfully' };
    } catch (error: any) {
      console.error('Update email error:', error);
      throw error;
    }
  }

  public async updatePassword(params: UpdatePasswordParams): Promise<{ message: string }> {
    try {
      const driver = getDriver();
      const session = driver.session();

      const { userId, currentPassword, newPassword } = params;

      // First, verify the current password
      const studentResult = await session.run(
        `
        MATCH (s:Student { id: $userId })
        RETURN s.password as password
        `,
        { userId }
      );

      if (studentResult.records.length === 0) {
        await session.close();
        throw new Error('Student not found');
      }

      const encryptedPassword = studentResult.records[0]?.get('password');
      
      const isPasswordValid = await compare(currentPassword, encryptedPassword);
      if (!isPasswordValid) {
        await session.close();
        throw new Error('Current password is incorrect');
      }

      // Check if new password is different from current
      const isSamePassword = await compare(newPassword, encryptedPassword);
      if (isSamePassword) {
        await session.close();
        throw new Error('New password must be different from current password');
      }

      // Hash the new password
      const newEncryptedPassword = await hash(newPassword, 10);

      // Update the password and signUpdate timestamp
      const signUpdate = Date.now();
      await session.run(
        `
        MATCH (s:Student { id: $userId })
        SET s.password = $newPassword, s.signUpdate = $signUpdate
        `,
        { userId, newPassword: newEncryptedPassword, signUpdate }
      );

      // Invalidate all existing tokens for this user
      await invalidateUserTokens(userId, signUpdate);

      await session.close();
      return { message: 'Password updated successfully. Please log in again.' };
    } catch (error: any) {
      console.error('Update password error:', error);
      throw error;
    }
  }

  /**
   * Authenticate or check registration status by wallet address
   * Returns user data if wallet exists and registration is complete
   * Returns partial status if wallet exists but registration incomplete
   * Returns null if wallet doesn't exist (needs registration)
   */
  public async loginByWallet(walletAddress: string): Promise<{
    status: 'authenticated' | 'incomplete_registration' | 'not_found';
    user: any | null;
    missingFields?: string[];
  }> {
    try {
      const driver = getDriver();
      const session = driver.session();
      
      // Search for student by wallet address (could be smartWalletAddress from server wallet or external wallet)
      const result = await session.run(
        `MATCH (s:Student)
         WHERE s.smartWalletAddress = $walletAddress 
            OR s.externalWalletAddress = $walletAddress
         RETURN s`,
        { walletAddress: walletAddress.toLowerCase() }
      );
      await session.close();

      if (result.records.length === 0) {
        // Wallet not found - user needs to register
        return { status: 'not_found', user: null };
      }

      const user = result.records[0]?.get('s').properties;
      
      // Check if user is suspended
      if (user.suspendedUntil) {
        const suspendedUntil = new Date(user.suspendedUntil);
        if (suspendedUntil > new Date()) {
          const formattedDate = suspendedUntil.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          throw new Error(`Your account is suspended until ${formattedDate}. Reason: ${user.suspendedReason || 'Not specified'}`);
        }
      }

      // Check for required fields to determine if registration is complete
      const requiredFields = ['email', 'givenName', 'familyName'];
      const missingFields = requiredFields.filter(field => !user[field]);

      if (missingFields.length > 0) {
        // Registration incomplete - return partial user with missing fields info
        const { password, ...safeUser } = user;
        return {
          status: 'incomplete_registration',
          user: { ...safeUser, tier: Number(user.tier) || 0 },
          missingFields
        };
      }

      // Full authentication - return user data
      const { password, tier, ...safeProperties } = user;
      return {
        status: 'authenticated',
        user: {
          ...safeProperties,
          tier: Number(tier) || 0
        }
      };
    } catch (error: any) {
      console.error('Wallet login error:', error);
      throw error;
    }
  }

  /**
   * Register a new student with wallet address
   * Creates a new student node linked to the external wallet address
   */
  public async registerByWallet(params: {
    walletAddress: string;
    email?: string;
    givenName?: string;
    familyName?: string;
    birthDate?: string;
    mobileNumber?: string;
  }): Promise<{ message: string; user: any }> {
    try {
      const id = nanoid(12);
      const signUpdate = Date.now();
      const { walletAddress, email, givenName, familyName, birthDate, mobileNumber } = params;

      const driver = getDriver();
      const session = driver.session();

      // Check if wallet address already exists
      const walletExists = await session.run(
        `MATCH (s:Student)
         WHERE s.smartWalletAddress = $walletAddress 
            OR s.externalWalletAddress = $walletAddress
         RETURN s LIMIT 1`,
        { walletAddress: walletAddress.toLowerCase() }
      );

      if (walletExists.records.length > 0) {
        await session.close();
        const err: any = new Error('WALLET_EXISTS');
        err.code = 'WALLET_EXISTS';
        throw err;
      }

      // Check if email already exists (if provided)
      if (email) {
        const emailExists = await session.run(
          `MATCH (s:Student { email: $email }) RETURN s LIMIT 1`,
          { email: email.toLowerCase() }
        );
        if (emailExists.records.length > 0) {
          await session.close();
          const err: any = new Error('EMAIL_EXISTS');
          err.code = 'EMAIL_EXISTS';
          throw err;
        }
      }

      // Create student with wallet address (no password required for wallet-based auth)
      await session.run(
        `CREATE (s:Student {
          id: $id,
          email: $email,
          role: 'student',
          familyName: $familyName,
          givenName: $givenName,
          birthDate: $birthDate,
          mobileNumber: $mobileNumber,
          signUpdate: $signUpdate,
          registeredAt: $signUpdate,
          suspendedUntil: null,
          suspendedReason: '',
          externalWalletAddress: $walletAddress,
          verifiedEmail: false,
          verifiedMobile: false,
          tier: 0
        })`,
        {
          id,
          email: email ? email.toLowerCase() : null,
          familyName: familyName || null,
          givenName: givenName || null,
          birthDate: birthDate || null,
          mobileNumber: mobileNumber || null,
          signUpdate,
          walletAddress: walletAddress.toLowerCase()
        }
      );

      // Fetch the created user
      const result = await session.run(
        `MATCH (s:Student { id: $id }) RETURN s`,
        { id }
      );
      await session.close();

      const user = result.records[0]?.get('s').properties;
      const { password: _, ...safeUser } = user;

      return {
        message: 'Registration successful',
        user: safeUser
      };
    } catch (error: any) {
      console.error('Wallet registration error:', error);
      throw error;
    }
  }

  /**
   * Link an external wallet address to an existing student account
   */
  public async linkWallet(userId: string, walletAddress: string): Promise<{ message: string }> {
    try {
      const driver = getDriver();
      const session = driver.session();

      // Check if wallet is already linked to another account
      const walletExists = await session.run(
        `MATCH (s:Student)
         WHERE (s.smartWalletAddress = $walletAddress OR s.externalWalletAddress = $walletAddress)
           AND s.id <> $userId
         RETURN s LIMIT 1`,
        { walletAddress: walletAddress.toLowerCase(), userId }
      );

      if (walletExists.records.length > 0) {
        await session.close();
        throw new Error('This wallet is already linked to another account');
      }

      await session.run(
        `MATCH (s:Student { id: $userId })
         SET s.externalWalletAddress = $walletAddress`,
        { userId, walletAddress: walletAddress.toLowerCase() }
      );

      await session.close();
      return { message: 'Wallet linked successfully' };
    } catch (error: any) {
      console.error('Link wallet error:', error);
      throw error;
    }
  }

  /**
   * Get student's own profile data
   */
  public async getOwnProfile(studentId: string) {
    
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (s:Student {id: $studentId})
        OPTIONAL MATCH (s)<-[:BOOKED_BY]-(b:Booking)
        WITH s, 
             COUNT(DISTINCT CASE WHEN b.status = 'confirmed' OR b.status = 'completed' THEN b END) as totalLessons,
             COUNT(DISTINCT CASE WHEN b.status = 'completed' AND b.attendanceStatus = 'present' THEN b END) as attendedLessons,
             COUNT(DISTINCT CASE WHEN b.status = 'confirmed' THEN b END) as upcomingLessons
        OPTIONAL MATCH (s)-[]-(assessmentNode)
        WHERE any(label IN labels(assessmentNode) WHERE label IN $assessmentLabels OR toLower(label) CONTAINS 'assessment')
        WITH s, totalLessons, attendedLessons, upcomingLessons, assessmentNode,
             coalesce(assessmentNode.dateAssessed, assessmentNode.assessmentDate, assessmentNode.assessedAt, assessmentNode.createdAt, assessmentNode.updatedAt, '') as assessmentSortKey
        ORDER BY assessmentSortKey DESC
        WITH s, totalLessons, attendedLessons, upcomingLessons, collect(assessmentNode)[0] as latestAssessment
        RETURN s {
          .*,
          totalLessons: totalLessons,
          attendedLessons: attendedLessons,
          upcomingLessons: upcomingLessons,
          attendanceRate: CASE WHEN totalLessons > 0 THEN (attendedLessons * 100.0 / totalLessons) ELSE 0 END,
          studentLevelAssessment: s.levelAssessment,
          levelAssessment: CASE WHEN latestAssessment IS NULL THEN null ELSE properties(latestAssessment) END
        } as student
        `,
        {
          studentId,
          assessmentLabels: ['LevelAssessment', 'StudentAssessment', 'AssessmentResult', 'StudentLevelAssessment']
        }
      );

      if (result.records.length === 0) {
        console.error('[StudentService] Student not found with ID:', studentId);
        throw new Error('Student not found');
      }

      const studentData = result.records[0]?.get('student');
      
      const profileData = {
        id: studentData.id,
        email: studentData.email,
        givenName: studentData.givenName,
        familyName: studentData.familyName,
        fullName: `${studentData.givenName || ''} ${studentData.familyName || ''}`.trim(),
        initials: `${studentData.givenName?.[0] || ''}${studentData.familyName?.[0] || ''}`.toUpperCase(),
        mobileNumber: studentData.mobileNumber,
        birthDate: studentData.birthDate,
        joinDate: studentData.signUpdate || null,
        totalLessons: typeof studentData.totalLessons === 'object' ? studentData.totalLessons.toInt() : (studentData.totalLessons || 0),
        upcomingLessons: typeof studentData.upcomingLessons === 'object' ? studentData.upcomingLessons.toInt() : (studentData.upcomingLessons || 0),
        attendance: Math.round(Number(studentData.attendanceRate) || 0),
        smartWalletAddress: studentData.smartWalletAddress,
        // Personal info fields
        currentProficiency: studentData.currentProficiency || 'Beginner',
        learningGoals: studentData.learningGoals ? (typeof studentData.learningGoals === 'string' ? JSON.parse(studentData.learningGoals) : studentData.learningGoals) : [],
        preferredLearningStyle: studentData.preferredLearningStyle,
        availability: studentData.availability ? (typeof studentData.availability === 'string' ? JSON.parse(studentData.availability) : studentData.availability) : [],
        country: studentData.country,
        regionName: studentData.regionName || studentData.region || '',
        timezone: studentData.timezone || 'GMT+8 (Philippine Time)',
        interests: studentData.interests,
        preferredTopics: studentData.preferredTopics ? (typeof studentData.preferredTopics === 'string' ? JSON.parse(studentData.preferredTopics) : studentData.preferredTopics) : [],
        // Lesson preferences
        lessonPreferences: studentData.lessonPreferences ? (typeof studentData.lessonPreferences === 'string' ? JSON.parse(studentData.lessonPreferences) : studentData.lessonPreferences) : {
          preferCameraOn: true,
          errorCorrection: 'tutor_choice',
          otherRequests: ''
        },
        // About Me fields
        purpose: studentData.purpose || '',
        occupation: studentData.occupation || '',
        hobbies: studentData.hobbies ? (Array.isArray(studentData.hobbies) ? studentData.hobbies : []) : [],
        bio: studentData.bio || '',
        levelAssessment: buildLevelAssessment(studentData.levelAssessment, studentData)
      };
      
      return profileData;
    } catch (error) {
      console.error('[StudentService] Error getting own profile:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Update student's lesson preferences
   */
  public async updateLessonPreferences(studentId: string, preferences: {
    preferCameraOn: boolean;
    errorCorrection: 'during_feedback' | 'proactively' | 'tutor_choice';
    otherRequests: string;
  }) {
    
    const driver = getDriver();
    const session = driver.session();

    try {
      const preferencesJson = JSON.stringify(preferences);
      
      const result = await session.run(
        `
        MATCH (s:Student {id: $studentId})
        SET s.lessonPreferences = $preferences
        RETURN s.id as id
        `,
        { studentId, preferences: preferencesJson }
      );

      if (result.records.length === 0) {
        throw new Error('Student not found');
      }

      return { success: true, message: 'Preferences updated successfully' };
    } catch (error) {
      console.error('[StudentService] Error updating lesson preferences:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Update student's About Me info (purpose, occupation, hobbies)
   */
  public async updateAboutMe(studentId: string, aboutMe: {
    purpose: string;
    occupation: string;
    hobbies: string[];
    bio: string;
  }) {
    
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (s:Student {id: $studentId})
        SET s.purpose = $purpose,
            s.occupation = $occupation,
            s.hobbies = $hobbies,
            s.bio = $bio
        RETURN s.id as id
        `,
        { 
          studentId, 
          purpose: aboutMe.purpose,
          occupation: aboutMe.occupation,
          hobbies: aboutMe.hobbies,
          bio: aboutMe.bio
        }
      );

      if (result.records.length === 0) {
        throw new Error('Student not found');
      }

      return { success: true, message: 'About Me updated successfully' };
    } catch (error) {
      console.error('[StudentService] Error updating About Me:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Save last viewed lesson for student
   */
  public async saveLastViewedLesson(studentId: string, lesson: {
    sessionId?: string;
    courseId: string;
    lessonId: string;
    lessonNumber: number;
    title: string;
    goal: string;
    viewedAt: number;
  }) {
    
    const driver = getDriver();
    const session = driver.session();

    try {
      if (lesson.sessionId) {
        const result = await session.run(
          `
          MATCH (:Booking {bookingId: $sessionId})-[:BOOKED_BY]->(s:Student {id: $studentId})
          OPTIONAL MATCH (material:LessonMaterial {id: $lessonId, course: $courseId})
          MERGE (selection:ClassroomLessonSelection {
            studentId: $studentId,
            sessionId: $sessionId
          })
          SET selection.courseId = $courseId,
              selection.lessonId = $lessonId,
              selection.lessonNumber = $lessonNumber,
              selection.title = $title,
              selection.goal = $goal,
              selection.level = material.level,
              selection.chapter = material.chapter,
              selection.viewedAt = $viewedAt,
              selection.updatedAt = datetime()
          MERGE (s)-[:SELECTED_MATERIAL_FOR]->(selection)
          RETURN selection.sessionId AS sessionId
          `,
          {
            studentId,
            sessionId: lesson.sessionId,
            courseId: lesson.courseId,
            lessonId: lesson.lessonId,
            lessonNumber: lesson.lessonNumber,
            title: lesson.title,
            goal: lesson.goal,
            viewedAt: lesson.viewedAt,
          }
        );

        if (result.records.length === 0) {
          throw new Error('Student not found');
        }

        return { success: true, message: 'Classroom lesson selection saved' };
      }

      const result = await session.run(
        `
        MATCH (s:Student {id: $studentId})
        SET s.lastViewedCourseId = $courseId,
            s.lastViewedLessonId = $lessonId,
            s.lastViewedLessonNumber = $lessonNumber,
            s.lastViewedLessonTitle = $title,
            s.lastViewedLessonGoal = $goal,
            s.lastViewedAt = $viewedAt
        RETURN s.id as id
        `,
        { 
          studentId,
          courseId: lesson.courseId,
          lessonId: lesson.lessonId,
          lessonNumber: lesson.lessonNumber,
          title: lesson.title,
          goal: lesson.goal,
          viewedAt: lesson.viewedAt
        }
      );

      if (result.records.length === 0) {
        throw new Error('Student not found');
      }

      return { success: true, message: 'Last viewed lesson saved' };
    } catch (error) {
      console.error('[StudentService] Error saving last viewed lesson:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get last viewed lesson for student
   */
  public async getLastViewedLesson(studentId: string, sessionId?: string) {
    
    const driver = getDriver();
    const session = driver.session();

    try {
      if (sessionId) {
        const scopedResult = await session.run(
          `
          MATCH (:Student {id: $studentId})-[:SELECTED_MATERIAL_FOR]->
                (selection:ClassroomLessonSelection {studentId: $studentId, sessionId: $sessionId})
          RETURN selection.courseId AS courseId,
                 selection.lessonId AS lessonId,
                 selection.lessonNumber AS lessonNumber,
                 selection.title AS title,
                 selection.goal AS goal,
                 selection.level AS level, selection.chapter AS chapter,
                 selection.viewedAt AS viewedAt
          `,
          { studentId, sessionId }
        );

        if (scopedResult.records.length > 0) {
          const record = scopedResult.records[0]!;
          if (!record.get('courseId') || !record.get('lessonId')) return { success: true, data: null };
          return {
            success: true,
            data: {
              courseId: record.get('courseId'),
              lessonId: record.get('lessonId'),
              lessonNumber: record.get('lessonNumber'),
              title: record.get('title'),
              goal: record.get('goal'),
              level: record.get('level') == null ? null : Number(record.get('level')),
              chapter: record.get('chapter') == null ? null : Number(record.get('chapter')),
              viewedAt: record.get('viewedAt'),
            }
          };
        }

        // Preserve one legacy selection by assigning it to the first classroom
        // session that requests it. Subsequent sessions remain independent.
        const migrationResult = await session.run(
          `
          MATCH (s:Student {id: $studentId})
          WHERE s.lastViewedCourseId IS NOT NULL
            AND NOT (s)-[:SELECTED_MATERIAL_FOR]->(:ClassroomLessonSelection)
          CREATE (selection:ClassroomLessonSelection {
            studentId: $studentId,
            sessionId: $sessionId,
            courseId: s.lastViewedCourseId,
            lessonId: s.lastViewedLessonId,
            lessonNumber: s.lastViewedLessonNumber,
            title: s.lastViewedLessonTitle,
            goal: s.lastViewedLessonGoal,
            viewedAt: s.lastViewedAt,
            updatedAt: datetime()
          })
          CREATE (s)-[:SELECTED_MATERIAL_FOR]->(selection)
          RETURN selection.courseId AS courseId,
                 selection.lessonId AS lessonId,
                 selection.lessonNumber AS lessonNumber,
                 selection.title AS title,
                 selection.goal AS goal,
                 selection.viewedAt AS viewedAt
          `,
          { studentId, sessionId }
        );

        if (migrationResult.records.length === 0) {
          return { success: true, data: null };
        }

        const migrated = migrationResult.records[0]!;
        return {
          success: true,
          data: {
            courseId: migrated.get('courseId'),
            lessonId: migrated.get('lessonId'),
            lessonNumber: migrated.get('lessonNumber'),
            title: migrated.get('title'),
            goal: migrated.get('goal'),
            viewedAt: migrated.get('viewedAt'),
          }
        };
      }

      const result = await session.run(
        `
        MATCH (s:Student {id: $studentId})
        RETURN s.lastViewedCourseId as courseId,
               s.lastViewedLessonId as lessonId,
               s.lastViewedLessonNumber as lessonNumber,
               s.lastViewedLessonTitle as title,
               s.lastViewedLessonGoal as goal,
               s.lastViewedAt as viewedAt
        `,
        { studentId }
      );

      if (result.records.length === 0 || !result.records[0]?.get('courseId')) {
        return { success: true, data: null };
      }

      const record = result.records[0]!;
      const lessonData = {
        courseId: record.get('courseId'),
        lessonId: record.get('lessonId'),
        lessonNumber: record.get('lessonNumber'),
        title: record.get('title'),
        goal: record.get('goal'),
        viewedAt: record.get('viewedAt')
      };

      return { success: true, data: lessonData };
    } catch (error) {
      console.error('[StudentService] Error getting last viewed lesson:', error);
      throw error;
    } finally {
      await session.close();
    }
  }
}

export default StudentService;

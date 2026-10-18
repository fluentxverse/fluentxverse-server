//** ELYSIA TYPE VALIDATION IMPORT
import { t } from "elysia";
import { 
  Email, 
  Password, 
  LoginPassword,
  Name, 
  PhoneNumber, 
  DateString, 
  SafeString,
  ZipCode 
} from "../../utils/validation";


// A minimal safe user shape returned to clients
export const UserSchema = t.Object({
    id: t.String(),
    userId: t.String(),
    email: Email(),
    firstName: t.Optional(t.String()),
    lastName: t.Optional(t.String()),
    mobileNumber: t.String(),
    tier: t.Number(),
    role: t.String(),
    walletAddress: t.String()
});


export const RegisterSchema = {
    body: t.Object({
        email: Email(),
        password: Password(),
        firstName: Name({ minLength: 1, maxLength: 50 }),
        middleName: t.Optional(Name({ minLength: 1, maxLength: 50 })),
        lastName: Name({ minLength: 1, maxLength: 50 }),
        suffix: t.Optional(t.String({ maxLength: 10 })),
        birthDate: DateString(),
        mobileNumber: PhoneNumber(),
    })
}


export const LoginSchema = {
    body: t.Object({
        email: Email(),
        password: LoginPassword(),
    }),
    response: {
        200: t.Object({
            success: t.Boolean(),
            user: t.Any(),
            error: t.Optional(t.String())
        })
    }
}

export const LogoutSchema = {
    response: {
        200: t.Object({
            success: t.Boolean(),
            message: t.String()
        })
    }
}

export const MeSchema = {
    response: {
        200: t.Object({
            user: t.Object({
                userId: t.String(),
                email: t.String(),
                firstName: t.Optional(t.String()),
                lastName: t.Optional(t.String()),
                walletAddress: t.Optional(t.String()),
                mobileNumber: t.Optional(t.String()),
                tier: t.Number(),
                profilePicture: t.Optional(t.String())
            })
        }),
        401: t.Object({ user: t.Null(), error: t.String() }),
        500: t.Object({ user: t.Null(), error: t.String() })
    }
}

export const UpdatePersonalInfoSchema = {
    body: t.Object({
        phoneNumber: t.Optional(PhoneNumber()),
        // Address
        country: t.Optional(SafeString({ maxLength: 100 })),
        region: t.Optional(SafeString({ maxLength: 100 })),
        regionName: t.Optional(SafeString({ maxLength: 100 })),
        province: t.Optional(SafeString({ maxLength: 100 })),
        provinceName: t.Optional(SafeString({ maxLength: 100 })),
        city: t.Optional(SafeString({ maxLength: 100 })),
        cityName: t.Optional(SafeString({ maxLength: 100 })),
        zipCode: t.Optional(ZipCode()),
        addressLine: t.Optional(SafeString({ maxLength: 500 })),
        sameAsPermanent: t.Optional(t.Boolean()),
        // Tutor Qualifications
        schoolAttended: t.Optional(SafeString({ maxLength: 200 })),
        educationalAttainment: t.Optional(SafeString({ maxLength: 100 })),
        major: t.Optional(SafeString({ maxLength: 100 })),
        teachingExperience: t.Optional(SafeString({ maxLength: 50 })),
        teachingQualifications: t.Optional(t.Array(SafeString({ maxLength: 100 }), { maxItems: 20 })),
        // Student Learning Preferences
        currentProficiency: t.Optional(SafeString({ maxLength: 50 })),
        learningGoals: t.Optional(t.Array(SafeString({ maxLength: 200 }), { maxItems: 10 })),
        preferredLearningStyle: t.Optional(SafeString({ maxLength: 50 })),
        availability: t.Optional(t.Array(SafeString({ maxLength: 50 }), { maxItems: 14 })),
    }),
    response: {
        200: t.Object({
            success: t.Boolean(),
            message: t.String()
        })
    }
}

export const UpdateEmailSchema = {
    body: t.Object({
        newEmail: Email(),
        currentPassword: LoginPassword()
    }),
    response: {
        200: t.Object({
            success: t.Boolean(),
            message: t.String()
        })
    }
}

export const UpdatePasswordSchema = {
    body: t.Object({
        currentPassword: LoginPassword(),
        newPassword: Password()
    }),
    response: {
        200: t.Object({
            success: t.Boolean(),
            message: t.String()
        })
    }
}

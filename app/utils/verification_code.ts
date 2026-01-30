/**
 * Utility functions for OTP verification codes
 */

/**
 * Generate a random 6-digit verification code
 */
export function generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Validate a verification code format
 */
export function isValidCodeFormat(code: string): boolean {
    return /^\d{6}$/.test(code)
}

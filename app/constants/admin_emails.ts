export const ADMIN_EMAILS = ['sublymus@gmail.com', 'sablymus@gmail.com', 'seblymus@gmail.com', 'opus@sublymus.com']

export function isAdminEmail(email: string): boolean {
    return ADMIN_EMAILS.includes(email)
}

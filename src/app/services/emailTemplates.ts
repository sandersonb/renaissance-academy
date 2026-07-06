/**
 * Email templates — render an outbox row (template + payload) into a subject +
 * body. Plain text, mirroring the legacy Susi Blackhurst sign-off. Keeping these
 * as data-light functions makes them easy to tweak without touching send logic.
 */
const SIGNOFF = '\n\nBest regards,\nSusi Blackhurst\nEnrollment Specialist\nRenaissance Academy';

export function renderEmail(template: string, p: Record<string, unknown>): { subject: string; body: string } {
  switch (template) {
    case 'confirmation':
      return {
        subject: 'Renaissance Academy — confirm your account',
        body: `Thank you for registering for the Renaissance Academy lottery.\n\nPlease confirm your account: ${p.link}${SIGNOFF}`,
      };
    case 'password_reset':
      return {
        subject: 'Renaissance Academy — password reset',
        body: `A password reset was requested for your account.\n\nReset your password: ${p.link}\n\nIf you didn't request this, you can ignore this email.${SIGNOFF}`,
      };
    case 'offer':
      return {
        subject: 'Enrollment — a position is available (action required)',
        body: `${p.firstName ?? 'Hello'},\n\nA position is available for one or more of your students. Please log in to accept it before the deadline: ${p.link}${SIGNOFF}`,
      };
    case 'reminder':
      return {
        subject: 'Enrollment deadline — action required',
        body: `${p.firstName ?? 'Hello'},\n\nOne or more of your students has an open item (offer to accept or paperwork due). Please log in: ${p.link}\n\nThis is an automated reminder.${SIGNOFF}`,
      };
    default:
      return { subject: 'Renaissance Academy Enrollment', body: String(p.body ?? '') + SIGNOFF };
  }
}

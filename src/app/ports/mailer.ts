/** Outbound email port. ConsoleMailer (dev) logs; a real provider lands in M4. */
export interface Mailer {
  sendConfirmation(email: string, link: string): Promise<void>;
  sendPasswordReset(email: string, link: string): Promise<void>;
}

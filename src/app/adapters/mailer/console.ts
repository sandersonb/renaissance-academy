import type { Mailer } from '../../ports/mailer.js';

/** Dev mailer: logs the link instead of sending. Replace with a provider (M4). */
export class ConsoleMailer implements Mailer {
  async sendConfirmation(email: string, link: string) {
    console.log(`[mail] confirmation -> ${email}: ${link}`);
  }
  async sendPasswordReset(email: string, link: string) {
    console.log(`[mail] password reset -> ${email}: ${link}`);
  }
}

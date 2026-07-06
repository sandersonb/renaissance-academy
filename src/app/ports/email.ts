/** A rendered email and the provider that delivers it (SMTP, SES, console…). */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

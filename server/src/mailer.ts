/**
 * server/src/mailer.ts
 * Sends the account mails: sign-up codes, password reset codes and the "you already have an account" notice.
 * Development/test: kept in memory and logged. Production: SMTP.
 */

import nodemailer from 'nodemailer';

export interface Mailer {
  sendSignupCode(email: string, code: string): Promise<void>;
  sendResetCode(email: string, code: string): Promise<void>;
  /** Someone asked for a sign-up code for an address that already has an account. */
  sendAccountExists(email: string): Promise<void>;
}

type MailKind = 'signup' | 'reset' | 'exists';

export class MemoryMailer implements Mailer {
  readonly outbox: Array<{ email: string; code: string; kind: MailKind }> = [];

  constructor(private readonly log?: (msg: string) => void) {}

  async sendSignupCode(email: string, code: string): Promise<void> {
    this.outbox.push({ email, code, kind: 'signup' });
    this.log?.(`[dev mail] sign-up code for ${email}: ${code}`);
  }

  async sendResetCode(email: string, code: string): Promise<void> {
    this.outbox.push({ email, code, kind: 'reset' });
    this.log?.(`[dev mail] password reset code for ${email}: ${code}`);
  }

  async sendAccountExists(email: string): Promise<void> {
    this.outbox.push({ email, code: '', kind: 'exists' });
    this.log?.(`[dev mail] account already exists for ${email}`);
  }

  lastCodeFor(email: string): string | undefined {
    return [...this.outbox].reverse().find((m) => m.email === email && m.code)?.code;
  }

  lastMailFor(email: string): { code: string; kind: MailKind } | undefined {
    return [...this.outbox].reverse().find((m) => m.email === email);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendSignupCode(email: string, code: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: `Your sign-up code: ${code}`,
      text:
        `Your sign-up code is ${code}.\n\nIt is valid for 10 minutes. ` +
        `If you did not request it, you can ignore this email.`,
    });
  }

  async sendResetCode(email: string, code: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: `Your password reset code: ${code}`,
      text:
        `Your password reset code is ${code}.\n\nIt is valid for 10 minutes. Resetting your password signs you out on ` +
        `every other device.\n\nIf you did not request it, you can ignore this email: your password stays the same.`,
    });
  }

  async sendAccountExists(email: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: 'You already have an account',
      text:
        `Someone (probably you) tried to create an account with this email address, but you already have one.\n\n` +
        `Sign in with your email address and password. Forgot your password? Use "Forgot password?" on the sign-in screen.\n\n` +
        `If this was not you, you can ignore this email: nothing has changed.`,
    });
  }
}

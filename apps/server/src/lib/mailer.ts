import type { EmailConfig } from '../config';

// Outgoing email. The server only ever sends short transactional messages
// (codes), so a plain HTTP call to the provider is all it needs.

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export function createMailer(config: EmailConfig | undefined): Mailer | undefined {
  if (!config) return undefined;
  if (config.provider === 'log') {
    return {
      async send(email) {
        console.log(`[email] to ${email.to}: ${email.subject}\n${email.text}`);
      },
    };
  }
  const { apiKey, from } = config;
  return {
    async send(email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    },
  };
}

/** Collects mail instead of sending it. For tests. */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
  }
  /** The last 6-digit code sent to `to`. */
  codeFor(to: string): string | undefined {
    const mail = this.sent.findLast((m) => m.to === to);
    return mail?.text.match(/\b\d{6}\b/)?.[0];
  }
}

import type { EmailMessage, EmailPort, Logger } from '../ports.js';

/** Development adapter: logs a redacted message instead of sending. */
export class LogEmail implements EmailPort {
  readonly driver = 'log';
  readonly sent: EmailMessage[] = [];
  constructor(private readonly log: Logger) {}
  async send(message: EmailMessage) {
    this.sent.push(message);
    this.log.info(
      {
        template: message.template,
        to: redactEmail(message.to),
        idempotencyKey: message.idempotencyKey,
      },
      'email (log driver, not sent)',
    );
  }
}

export function redactEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

import nodemailer from "nodemailer";
import { config } from "../config/index.js";

const { smtp, mailFrom } = config.email;

let transporter = null;
function getTransporter() {
  if (!smtp.host) return null;
  transporter ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return transporter;
}

export const emailConfigured = () => Boolean(smtp.host);

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const COPY = {
  signup: {
    subject: (code) => `${code} is your Ask AI verification code`,
    intro: "Use this code to verify your email and finish creating your Ask AI account.",
  },
  reset: {
    subject: (code) => `${code} is your Ask AI password reset code`,
    intro: "Use this code to reset your Ask AI password.",
  },
};

/**
 * Emails a one-time code. Without SMTP settings (local development) the code
 * is printed to the server console instead, so the flow can still be tested.
 */
export async function sendVerificationCode(email, code, purpose, ttlMinutes) {
  const copy = COPY[purpose] ?? COPY.signup;
  const transport = getTransporter();

  if (!transport) {
    if (config.isProduction) {
      throw Object.assign(new Error("Email sending isn't configured on the server."), { status: 503 });
    }
    console.log(`\n📧 [dev] ${purpose} code for ${email}: ${code}  (set SMTP_HOST in .env to send real emails)\n`);
    return;
  }

  const text = `${copy.intro}\n\nYour code: ${code}\n\nIt expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f0f4f9;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:bold;padding-bottom:16px">Ask AI</td></tr>
      <tr><td style="font-size:15px;line-height:1.5;padding-bottom:24px">${escapeHtml(copy.intro)}</td></tr>
      <tr><td align="center" style="padding-bottom:24px">
        <div style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:bold;background:#d3e3fd;color:#041e49;border-radius:12px;padding:14px 24px">${escapeHtml(code)}</div>
      </td></tr>
      <tr><td style="font-size:13px;color:#5f6368;line-height:1.5">This code expires in ${ttlMinutes} minutes. If you didn't request it, you can ignore this email.</td></tr>
    </table>
  </td></tr></table></body></html>`;

  await transport.sendMail({ from: mailFrom, to: email, subject: copy.subject(code), text, html });
}

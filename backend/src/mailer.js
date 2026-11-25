// Outgoing email over SMTP (e.g. Gmail with an App Password). Configured only through the environment:
// EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM. Without them, nothing is sent and the app
// keeps working (in-app mail still delivers between Hunch accounts).
import nodemailer from 'nodemailer';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';
import { CLIENT_URL, ADMIN_URL, REAL_SERVICES } from './config.js';
import { isStaffRole } from '../../shared/constants.js';

const cfg = {
  host: process.env.EMAIL_HOST || '',
  port: Number(process.env.EMAIL_PORT) || 587,
  user: process.env.EMAIL_USER || '',
  pass: process.env.EMAIL_PASS || '',
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
};
export const mailEnabled = () => REAL_SERVICES && !!(cfg.host && cfg.user && cfg.pass);
let transport = null;
const tx = () => (transport ||= nodemailer.createTransport({
  host: cfg.host, port: cfg.port, secure: cfg.port === 465, requireTLS: cfg.port === 587,
  auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 15000,
}));
// Demo and placeholder accounts never get real mail.
const deliverable = (addr) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr || '') && !/@hunch\.local$/i.test(addr) && !/@example\.(com|org)$/i.test(addr);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Simple branded HTML wrapper; `lines` are plain text paragraphs. */
const layout = (title, lines, cta) => `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border-radius:16px;padding:28px">
<div style="font-weight:800;font-size:20px;margin-bottom:18px">Hunch</div>
<h1 style="font-size:20px;margin:0 0 14px">${esc(title)}</h1>
${lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;white-space:pre-wrap">${esc(l)}</p>`).join('')}
${cta ? `<p style="margin:22px 0 0"><a href="${esc(cta.url)}" style="background:#5b8def;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px;display:inline-block">${esc(cta.label)}</a></p>` : ''}
</div><p style="font-size:12px;color:#888;text-align:center;margin-top:16px">Sent by Hunch. If you weren’t expecting this, you can ignore it.</p></div></body></html>`;

/** Send one email. Resolves to true when sent, false when skipped or failed (never throws). */
export async function sendMail({ to, subject, text, html, attachments = [] }) {
  const list = [].concat(to).filter(deliverable);
  if (!mailEnabled()) {
    // Local testing: show the email in the terminal instead of sending it.
    if (!REAL_SERVICES) console.log(`[hunch] (test mode, not sent) Email to ${[].concat(to).join(', ')}: "${subject}"\n${text}\n`);
    return false;
  }
  if (!list.length) return false;
  try {
    await tx().sendMail({ from: `Hunch <${cfg.from}>`, to: list.join(', '), subject, text, html, attachments });
    return true;
  } catch (e) {
    console.warn('[hunch] email not sent:', e.message);
    return false;
  }
}

// Attachments stored by the email center: Cloudinary URLs are fetched by the mailer; local ones read from disk.
export const mailAttachments = (list) => (list || []).map((a) => (/^https?:\/\//.test(a.url) && !a.url.includes('/uploads/')
  ? { filename: a.name, path: a.url }
  : { filename: a.name, path: path.join(UPLOAD_DIR, path.basename(String(a.url))) }));

// ---------- templates ----------
export const sendVerificationCode = (to, name, code) => sendMail({
  to, subject: `Your Hunch verification code: ${code}`,
  text: `Hi ${name},\n\nYour Hunch verification code is ${code}. It expires in 15 minutes.`,
  html: layout('Verify your email', [`Hi ${name},`, `Your verification code is:`, code, 'It expires in 15 minutes.']),
});
export const sendWelcome = (to, name, login, tempPassword, role) => {
  const url = isStaffRole(role) ? ADMIN_URL : CLIENT_URL;
  return sendMail({
    to, subject: 'Your Hunch account is ready',
    text: `Hi ${name},\n\nAn account was created for you on Hunch.\nSign in: ${url}\nUsername or email: ${login}\nTemporary password: ${tempPassword}\n\nYou'll be asked to verify your email and choose a new password the first time you sign in.`,
    html: layout('Welcome to Hunch', [`Hi ${name},`, 'An account was created for you.', `Username or email: ${login}`, `Temporary password: ${tempPassword}`, 'You’ll verify your email and choose a new password the first time you sign in.'], { url, label: 'Sign in to Hunch' }),
  });
};
export const sendPasswordReset = (to, name, tempPassword, role) => {
  const url = isStaffRole(role) ? ADMIN_URL : CLIENT_URL;
  return sendMail({
    to, subject: 'Your Hunch password was reset',
    text: `Hi ${name},\n\nYour Hunch password was reset by an administrator.\nTemporary password: ${tempPassword}\nSign in at ${url} and choose a new password.`,
    html: layout('Your password was reset', [`Hi ${name},`, 'An administrator reset your password.', `Temporary password: ${tempPassword}`, 'Sign in and choose a new password right away.'], { url, label: 'Sign in' }),
  });
};
export const sendTeamInvite = (to, inviter, teamName) => sendMail({
  to, subject: `${inviter} invited you to ${teamName} on Hunch`,
  text: `${inviter} invited you to join the team "${teamName}" on Hunch.\nCreate your free account with this email address at ${CLIENT_URL} and you'll find the invitation in Work.`,
  html: layout(`Join ${teamName} on Hunch`, [`${inviter} invited you to join the team “${teamName}”.`, 'Create your free Hunch account with this email address, turn on Work Mode in Settings, and accept the invitation in Work.'], { url: CLIENT_URL, label: 'Join Hunch' }),
});
export const sendComposed = (to, fromName, subject, body, attachments) => sendMail({
  to, subject: subject || '(no subject)',
  text: `${body}\n\n${fromName} via Hunch`,
  html: layout(subject || '(no subject)', [body, `${fromName} via Hunch`]),
  attachments: mailAttachments(attachments),
});

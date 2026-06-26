import type { Env } from "../env.ts";

// Send an email when a provider is configured; otherwise log it (dev fallback).
// `logLine` is what gets printed when no provider is bound.
async function sendEmail(
  env: Env,
  message: { to: string; subject: string; text: string; html: string },
  logLine: string,
): Promise<void> {
  if (env.EMAIL && env.EMAIL_FROM) {
    await env.EMAIL.send({ from: env.EMAIL_FROM, ...message });
    return;
  }
  console.log(logLine);
}

export async function sendLoginCode(env: Env, email: string, code: string): Promise<void> {
  await sendEmail(
    env,
    {
      to: email,
      subject: "Your bookclub login code",
      text:
        `Your bookclub login code is\n${code}\n\n` +
        `It expires in 10 minutes. If you didn't request it, ignore this email.`,
      html:
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#000;font-size:14px;line-height:1.5;">` +
        `<p style="margin:0;">Your bookclub login code is</p>` +
        `<p style="margin:8px 0;font-size:24px;font-weight:700;letter-spacing:3px;">${code}</p>` +
        `<p style="margin:0;">It expires in 10 minutes. If you didn't request it, ignore this email.</p>` +
        `</div>`,
    },
    `[auth] login code for ${email}: ${code}`,
  );
}

export async function sendInvite(
  env: Env,
  email: string,
  groupDisplayName: string,
  link: string,
): Promise<void> {
  await sendEmail(
    env,
    {
      to: email,
      subject: `You're invited to "${groupDisplayName}" on bookclub`,
      text:
        `You've been invited to join the "${groupDisplayName}" book club.\n\n` +
        `Open this link to join:\n${link}\n\n` +
        `If you didn't expect this invite, ignore this email.`,
      html:
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#000;font-size:14px;line-height:1.5;">` +
        `<p style="margin:0;">You've been invited to join the "${groupDisplayName}" book club.</p>` +
        `<p style="margin:12px 0;"><a href="${link}">${link}</a></p>` +
        `<p style="margin:0;">If you didn't expect this invite, ignore this email.</p>` +
        `</div>`,
    },
    `[invite] ${groupDisplayName} invite for ${email}: ${link}`,
  );
}

import type { Env } from "../env.ts";

// Deliver a login code to the user's inbox.
//
// When the Cloudflare send_email binding and a verified sender are configured
// (production), send a real email. Otherwise (local dev) log the code to the
// worker output so the maintainer can sign in — safe because "user enumeration
// is not a vuln" (step-6-plan decision 1).
//
// Note: the send_email binding can only deliver to **verified destination
// addresses** on the account (Cloudflare Email Routing limitation). For
// arbitrary public signups a third-party email API is required — see the
// onboarding notes in the handoff.
export async function sendLoginCode(env: Env, email: string, code: string): Promise<void> {
  if (env.EMAIL && env.EMAIL_FROM) {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
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
    });
    return;
  }
  console.log(`[auth] login code for ${email}: ${code}`);
}

// Deliver a group invite link to a prospective member. Same delivery seam as
// the login code: real send when configured, otherwise logged in local dev.
export async function sendInvite(
  env: Env,
  email: string,
  groupDisplayName: string,
  link: string,
): Promise<void> {
  if (env.EMAIL && env.EMAIL_FROM) {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
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
    });
    return;
  }
  console.log(`[invite] ${groupDisplayName} invite for ${email}: ${link}`);
}

import type { Env } from "./env.ts";

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
        `Your bookclub login code is ${code}.\n\n` +
        `It expires in 10 minutes. If you didn't request it, ignore this email.`,
    });
    return;
  }
  console.log(`[auth] login code for ${email}: ${code}`);
}

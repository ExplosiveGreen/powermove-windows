/* Transactional email. Email clients strip <style>, SVG and web fonts, so this is
   table layout with inline styles only, in the website's colors. */

const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** The one-time sign-in code. `otp` is server-generated digits, never user input. */
export function otpEmail(otp: string): { subject: string; text: string; html: string } {
  const subject = 'Your Powermove sign-in code';
  const text = `Your Powermove sign-in code is ${otp}. It expires in 5 minutes. If you didn't ask for this, ignore it.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#EEEEF1;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${otp}. It expires in 5 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEEEF1;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;">
<tr><td style="background:#FDFDFE;border:1px solid #E3E3E8;border-radius:12px;padding:32px;">
<p style="margin:0;font:500 20px/1.3 ${font};letter-spacing:-.02em;color:#1B1D23;">Your sign-in code</p>
<p style="margin:8px 0 24px;font:14px/1.5 ${font};color:#5A5C63;">Enter this code in Powermove to finish signing in.</p>
<div style="padding:18px 0 18px .3em;border-radius:8px;background:#F4F4F6;border:1px solid #E3E3E8;text-align:center;font:600 32px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.3em;color:#1B1D23;">${otp}</div>
<p style="margin:24px 0 0;font:13px/1.5 ${font};color:#7A7C82;">It expires in 5 minutes. If you didn’t ask for this, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:20px 4px 0;font:12px/1.5 ${font};color:#8E9096;">Powermove · trypowermove.com</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

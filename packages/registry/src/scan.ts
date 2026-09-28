import { grantsPermission, type ExtensionPermission } from './manifest';

export type ScanKind = 'openai_key' | 'anthropic_key' | 'aws_access_key' | 'github_token' | 'gitlab_token' | 'slack_token' | 'stripe_key' | 'google_api_key' | 'jwt' | 'pem_private_key' | 'high_entropy';
export interface ScanFinding { path: string; line: number; kind: ScanKind; hard: boolean; waived?: string }
export interface ScanResult { blocked: ScanFinding[]; waived: ScanFinding[] }
export interface CapabilityFinding { path: string; line: number; capability: 'network' | 'clipboard' }
export const WAIVER_COMMENT = /powermove-secret-ok:\s*(.{3,200})/;
const textFile = /(?:\.(?:ts|js|mjs|svelte|json|md|txt|css|html|frag|vert|glsl|wgsl|yml|yaml|toml)|(?:^|\/)\.env[^/]*)$/i;
const hardPatterns: [ScanKind, RegExp][] = [
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g],
  ['stripe_key', /\b(?:sk_live_|rk_live_)[A-Za-z0-9]{16,}\b/g],
  ['openai_key', /\bsk-(?!ant-|live_)[A-Za-z0-9_-]{16,}\b/g],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['gitlab_token', /\bglpat-[A-Za-z0-9_-]{16,}\b/g],
  ['slack_token', /\bxox[abpr]-[A-Za-z0-9-]{16,}\b/g],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
  ['pem_private_key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g]
];
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) { const p = count / s.length; bits -= p * Math.log2(p); }
  return bits;
}
function waiver(lines: string[], index: number): string | undefined {
  for (const line of [lines[index], lines[index - 1]]) {
    if (!line) continue;
    const comment = line.indexOf('//');
    if (comment < 0) continue;
    const match = WAIVER_COMMENT.exec(line.slice(comment));
    if (match && match[1]?.trim().length && match[1].trim().length >= 3) return match[1].trim();
  }
  return undefined;
}
export function scanText(path: string, text: string): ScanFinding[] {
  if (!textFile.test(path) || text.slice(0, 8192).includes('\0')) return [];
  const lines = text.split(/\r?\n/);
  const findings: ScanFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const [kind, pattern] of hardPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) findings.push({ path, line: i + 1, kind, hard: true });
    }
    const quoted = /(["'`])([^"'`\r\n]*?)\1/g;
    for (const match of line.matchAll(quoted)) {
      const value = match[2] ?? '';
      if (value.length < 32 || /\s/.test(value) || !/[A-Za-z]/.test(value) || !/\d/.test(value)) continue;
      if (/^(?:https?:\/\/|data:image\/|\.?\.?\/)/i.test(value) || value.includes('/') || value.includes('\\') || /^#[0-9a-f]+$/i.test(value)) continue;
      // Credentials are single tokens. Punctuation from CSS, code or prose
      // (`;`, `:`, brackets, commas) means this is not one.
      if (/[;:(),{}<>]/.test(value)) continue;
      if (hardPatterns.some(([, p]) => { p.lastIndex = 0; return p.test(value); })) continue;
      if (entropy(value) <= 4.5) continue;
      const reason = waiver(lines, i);
      findings.push(reason ? { path, line: i + 1, kind: 'high_entropy', hard: false, waived: reason } : { path, line: i + 1, kind: 'high_entropy', hard: false });
    }
  }
  return findings;
}
export function scanFiles(files: { path: string; text: string }[]): ScanResult {
  const blocked: ScanFinding[] = [], waived: ScanFinding[] = [];
  for (const file of files) for (const finding of scanText(file.path, file.text)) (finding.waived ? waived : blocked).push(finding);
  return { blocked, waived };
}
export function scanCapabilities(files: { path: string; text: string }[]): CapabilityFinding[] {
  const findings: CapabilityFinding[] = [];
  const network = /\bfetch\s*\(|\bnew\s+WebSocket\s*\(|\bXMLHttpRequest\b|\bnew\s+EventSource\s*\(|\bnavigator\s*\.\s*sendBeacon\b/;
  const clipboard = /\bnavigator\s*\.\s*clipboard\b/;
  for (const file of files) {
    if (!textFile.test(file.path) || file.text.slice(0, 8192).includes('\0')) continue;
    for (const [index, line] of file.text.split(/\r?\n/).entries()) {
      if (network.test(line)) findings.push({ path: file.path, line: index + 1, capability: 'network' });
      if (clipboard.test(line)) findings.push({ path: file.path, line: index + 1, capability: 'clipboard' });
    }
  }
  return findings;
}

/** Manifest `permissions` exist from apiVersion 3 (manifest.ts), so older code can declare none. */
export const PERMISSIONS_API_VERSION = 3;

/** The manifest change that grants `permissions`. Below apiVersion 3 that means raising it too. */
export function declarePermissionsHint(permissions: readonly ExtensionPermission[], apiVersion: number): string {
  const list = `\`permissions: [${permissions.map((permission) => `"${permission}"`).join(', ')}]\``;
  return apiVersion < PERMISSIONS_API_VERSION ? `Set \`apiVersion: ${PERMISSIONS_API_VERSION}\` and add ${list} to manifest.json.` : `Add ${list} to manifest.json.`;
}

/** Capabilities the code uses that the manifest doesn't grant. Below apiVersion 3 that is every one it uses. */
export function undeclaredCapabilities(files: { path: string; text: string }[], manifest: { apiVersion: number; permissions?: readonly string[] }): CapabilityFinding[] {
  const declared = manifest.apiVersion < PERMISSIONS_API_VERSION ? undefined : manifest.permissions;
  return scanCapabilities(files).filter((finding) => !grantsPermission(declared, finding.capability));
}

/** Undeclared capabilities as one sentence, for a publish that the store refused. */
export function undeclaredCapabilitiesText(findings: readonly CapabilityFinding[], apiVersion: number): string {
  const first = findings[0];
  if (!first) return '';
  const needs = [...new Set(findings.map((finding) => finding.capability))];
  const more = findings.length > 1 ? ` and ${findings.length - 1} more ${findings.length === 2 ? 'place' : 'places'}` : '';
  const what = needs.length === 1 ? `the ${needs[0]} permission` : `the ${needs.join(', ')} permissions`;
  return `${first.path}:${first.line}${more} ${findings.length > 1 ? 'need' : 'needs'} ${what}, which manifest.json doesn't declare. ${declarePermissionsHint(needs, apiVersion)}`;
}

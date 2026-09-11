import { isAddress, verifyMessage } from "viem";

export const AUTH_CHALLENGE_TTL_SECONDS = 5 * 60;
export const AUTH_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const INSTITUTIONAL_SESSION_COOKIE = "usance_institutional_session";

/**
 * The single seeded Phase 07 testnet organization (`institutional_organizations.slug`). A facility
 * is "explicitly assigned" to an organization by this server-side constant, never by a value the
 * client supplies — there is one organization and one facility today, and a second facility must
 * extend this map rather than trust a request body field.
 */
export const FACILITY_ORGANIZATION_SLUG: Record<string, string> = {
  "0x6534fdf67d36afeeb7118c7d81c7f4e06ab548735483ca249afcf12e6f75b1ee": "usance-phase07-testnet",
};

export function isCallerAssignedToFacility(caller: Pick<AuthSession, "organization_slug">, facilityId: string): boolean {
  return FACILITY_ORGANIZATION_SLUG[facilityId.toLowerCase()] === caller.organization_slug;
}

export type AuthChallenge = { id: string; wallet_address: string; nonce_hash: string; domain: string; uri: string; chain_id: number; statement: string; issued_at: string; expires_at: string; consumed_at: string | null };
export type AuthSession = { session_id: string; wallet_address: string; organization_id: string; organization_slug: string; organization_display_name: string; membership_role: string; expires_at: string };

function hex(bytes: Uint8Array): string { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function sha256(value: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
export function nonce(): string { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export function expectedOrigin(request: Request): string { return new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin; }
export function isSameOrigin(request: Request): boolean { return request.headers.get("origin") === expectedOrigin(request); }
export function authMessage(challenge: Pick<AuthChallenge, "domain" | "wallet_address" | "uri" | "chain_id" | "statement" | "issued_at" | "expires_at">, rawNonce: string): string {
  return [`${challenge.domain} wants you to sign in with your account:`, challenge.wallet_address, "", challenge.statement, "", `URI: ${challenge.uri}`, "Version: 1", `Chain ID: ${challenge.chain_id}`, `Nonce: ${rawNonce}`, `Issued At: ${challenge.issued_at}`, `Expiration Time: ${challenge.expires_at}`].join("\n");
}
export async function signatureMatches(challenge: AuthChallenge, rawNonce: string, signature: string): Promise<boolean> {
  if (!isAddress(challenge.wallet_address) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
  return verifyMessage({ address: challenge.wallet_address as `0x${string}`, message: authMessage(challenge, rawNonce), signature: signature as `0x${string}` });
}
function dbConfig(): { base: string; key: string } { const base = process.env.SUPABASE_URL?.replace(/\/$/, ""); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!base || !key) throw new Error("INSTITUTIONAL_AUTH_UNAVAILABLE"); return { base, key }; }
async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { base, key } = dbConfig(); const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("INSTITUTIONAL_AUTH_UNAVAILABLE"); return await response.json() as T;
}
export async function createChallenge(input: { walletAddress: string; request: Request }): Promise<{ challenge: AuthChallenge; message: string }> {
  if (!isAddress(input.walletAddress)) throw new Error("INVALID_WALLET_ADDRESS");
  const issuedAt = new Date(); const expiresAt = new Date(issuedAt.getTime() + AUTH_CHALLENGE_TTL_SECONDS * 1000); const rawNonce = nonce(); const origin = expectedOrigin(input.request);
  const challenge = await rpc<AuthChallenge>("create_auth_challenge", { p_wallet_address: input.walletAddress.toLowerCase(), p_nonce_hash: await sha256(rawNonce), p_domain: new URL(origin).host, p_uri: origin, p_chain_id: 11155111, p_statement: "This signature signs you in to the Usance institutional testnet workspace. It does not move funds and costs no gas.", p_issued_at: issuedAt.toISOString(), p_expires_at: expiresAt.toISOString() });
  return { challenge, message: authMessage(challenge, rawNonce) };
}
export async function findChallenge(challengeId: string): Promise<AuthChallenge | null> {
  const { base, key } = dbConfig(); const response = await fetch(`${base}/rest/v1/auth_challenges?id=eq.${encodeURIComponent(challengeId)}&select=*`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error("INSTITUTIONAL_AUTH_UNAVAILABLE"); const rows = await response.json() as AuthChallenge[]; return rows[0] ?? null;
}
export async function createSession(challenge: AuthChallenge, sessionToken: string): Promise<AuthSession> {
  const rows = await rpc<AuthSession[]>("consume_auth_challenge_and_create_session", { p_challenge_id: challenge.id, p_wallet_address: challenge.wallet_address, p_session_token_hash: await sha256(sessionToken), p_session_expires_at: new Date(Date.now() + AUTH_SESSION_TTL_SECONDS * 1000).toISOString() });
  const session = rows[0]; if (!session || session.membership_role !== "TESTNET_OPERATOR") throw new Error("INSTITUTIONAL_AUTH_UNAVAILABLE"); return session;
}
export async function lookupSession(sessionToken: string): Promise<AuthSession | null> { const rows = await rpc<AuthSession[]>("lookup_auth_session", { p_session_token_hash: await sha256(sessionToken) }); return rows[0] ?? null; }
export async function revokeSession(sessionToken: string): Promise<void> { await rpc<boolean>("revoke_auth_session", { p_session_token_hash: await sha256(sessionToken) }); }
export function cookieToken(request: Request): string | null { const part = (request.headers.get("cookie") ?? "").split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${INSTITUTIONAL_SESSION_COOKIE}=`)); return part ? decodeURIComponent(part.slice(INSTITUTIONAL_SESSION_COOKIE.length + 1)) : null; }

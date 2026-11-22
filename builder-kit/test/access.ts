// Test double for Cloudflare Access.
//
// In production, Access signs a JWT with its private key and the Worker checks it against the
// public keys published at `${TEAM_DOMAIN}/cdn-cgi/access/certs`. In tests there is no Access,
// so we play its role: generate our own key pair, serve the public key at the certs URL, and sign
// tokens with the private key. The Worker code under test is unchanged.

import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";

const KEY_ID = "test-key";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "RS256" };

// The Worker runs in the same isolate as the tests, so stubbing the global fetch also affects
// the Worker's JWKS download. Every other URL goes to the real fetch.
const certsUrl = `${env.TEAM_DOMAIN}/cdn-cgi/access/certs`;
const realFetch = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url === certsUrl) return Response.json({ keys: [publicJwk] });
	return realFetch(input, init);
});

type TokenOptions = {
	audience?: string;
	issuer?: string;
	expiresAt?: number | string; // seconds since epoch, or a duration like "5m"
	signWith?: CryptoKey;
};

/** A JWT shaped like the one Access sends in Cf-Access-Jwt-Assertion. */
export async function accessJwt(email: string, options: TokenOptions = {}) {
	return new SignJWT({ email })
		.setProtectedHeader({ alg: "RS256", kid: KEY_ID })
		.setIssuer(options.issuer ?? env.TEAM_DOMAIN)
		.setAudience(options.audience ?? env.POLICY_AUD)
		.setIssuedAt()
		.setExpirationTime(options.expiresAt ?? "5m")
		.sign(options.signWith ?? privateKey);
}

/** A private key the Worker does not trust, to simulate a forged token. */
export async function untrustedKey() {
	return (await generateKeyPair("RS256")).privateKey;
}

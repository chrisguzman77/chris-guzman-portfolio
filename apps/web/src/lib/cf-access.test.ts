import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { verifyAccessJwt } from "./cf-access";

const TEAM = "chris.cloudflareaccess.com";
const AUD = "aud-123";
let keys: ReturnType<typeof createLocalJWKSet>;
let sign: (claims?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
let foreign: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = ({ iss = `https://${TEAM}`, aud = AUD, exp = "5m" } = {}) =>
    new SignJWT({ email: "chris@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(pair.privateKey);
  const other = await generateKeyPair("RS256");
  foreign = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setExpirationTime("5m")
    .sign(other.privateKey);
});

function configure(team = TEAM, aud = AUD) {
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", team);
  vi.stubEnv("CF_ACCESS_AUD", aud);
}

afterEach(() => vi.unstubAllEnvs());

describe("verifyAccessJwt", () => {
  it("accepts a token signed for this team and application", async () => {
    configure();
    expect(await verifyAccessJwt(await sign(), keys)).toBe(true);
  });

  it("rejects a missing token, wrong audience, issuer, expiry or key", async () => {
    configure();
    expect(await verifyAccessJwt(null, keys)).toBe(false);
    expect(await verifyAccessJwt(await sign({ aud: "other" }), keys)).toBe(false);
    expect(
      await verifyAccessJwt(await sign({ iss: "https://evil.cloudflareaccess.com" }), keys),
    ).toBe(false);
    expect(await verifyAccessJwt(await sign({ exp: "-1m" }), keys)).toBe(false);
    expect(await verifyAccessJwt(foreign, keys)).toBe(false);
    expect(await verifyAccessJwt("not.a.jwt", keys)).toBe(false);
  });

  it("fails closed when unconfigured or misconfigured", async () => {
    const token = await sign();
    expect(await verifyAccessJwt(token, keys)).toBe(false); // no env at all
    configure("chris.example.com");
    expect(await verifyAccessJwt(token, keys)).toBe(false); // not a cloudflareaccess.com team
    configure(TEAM, "");
    expect(await verifyAccessJwt(token, keys)).toBe(false);
  });
});

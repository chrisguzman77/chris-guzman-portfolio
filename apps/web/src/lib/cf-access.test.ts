import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { requireAccess, verifyAccessJwt } from "./cf-access";

// requireAccess verifies against the remote key set; hand it the local one instead.
const jwks = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("jose", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jose")>()),
  createRemoteJWKSet:
    () =>
    (...args: unknown[]) =>
      (jwks.current as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));

const TEAM = "chris.cloudflareaccess.com";
const AUD = "aud-123";
let keys: ReturnType<typeof createLocalJWKSet>;
let sign: (claims?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
let foreign: string;
let noExp: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
  jwks.current = keys;
  sign = ({ iss = `https://${TEAM}`, aud = AUD, exp = "5m" } = {}) =>
    new SignJWT({ email: "chris@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(pair.privateKey);
  noExp = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
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
    expect(await verifyAccessJwt(noExp, keys)).toBe(false); // a token that never expires
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

describe("requireAccess", () => {
  function sendHeader(value?: string) {
    const get = vi.fn((name: string) =>
      name === "cf-access-jwt-assertion" ? (value ?? null) : null,
    );
    vi.mocked(headers).mockResolvedValue({ get } as unknown as Awaited<ReturnType<typeof headers>>);
    return get;
  }

  afterEach(() => vi.clearAllMocks());

  it("passes for a valid token, read from the Access header", async () => {
    configure();
    const get = sendHeader(await sign());
    await expect(requireAccess()).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledWith("cf-access-jwt-assertion");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("answers 404 when the header is missing or the token is bad", async () => {
    configure();
    sendHeader();
    await expect(requireAccess()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    sendHeader(foreign);
    await expect(requireAccess()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalledTimes(2);
  });
});

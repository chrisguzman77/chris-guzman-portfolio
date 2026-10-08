import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { serverEnv } from "@/lib/env";

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

// One cached key set per team; jose refetches Cloudflare's rotating keys as needed.
let remote: { team: string; keys: JWTVerifyGetKey } | undefined;

function remoteKeys(team: string): JWTVerifyGetKey {
  if (remote?.team !== team) {
    remote = { team, keys: createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)) };
  }
  return remote.keys;
}

/** True only for a Cloudflare Access JWT issued by our team for the admin application. */
export async function verifyAccessJwt(
  token: string | null,
  keys?: JWTVerifyGetKey,
): Promise<boolean> {
  const { cfAccessTeamDomain: team, cfAccessAud: aud } = serverEnv();
  if (!token || !team || !aud || !TEAM_DOMAIN.test(team)) return false;
  try {
    await jwtVerify(token, keys ?? remoteKeys(team), {
      issuer: `https://${team}`,
      audience: aud,
      algorithms: ["RS256"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The admin page sits behind a Cloudflare Access path application; this re-checks the JWT
 * that Access adds, so a request that reached the origin any other way gets a 404.
 */
export async function requireAccess(): Promise<void> {
  const token = (await headers()).get("cf-access-jwt-assertion");
  if (!(await verifyAccessJwt(token))) notFound();
}

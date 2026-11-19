// Runtime configuration from environment variables, checked once at startup.
//
// Local (default): one listener on 127.0.0.1:4321, no login, localhost Host headers only, and /mcp with the
// local bearer token from Settings.
//
// Deployed (HEYANN_PUBLIC_ORIGIN set): the UI listener also accepts that origin's host, requires HTTPS from a
// trusted proxy, and requires the owner password (remembered for 30 days per device). The local-token /mcp is gone; MCP is served only
// on its own listener (HEYANN_MCP_PORT) with Orbit Identity OAuth, once that is configured.

import { BlockList, isIP } from 'node:net';

export interface OAuthConfig {
  issuer: string;
  /** The MCP URL clients enter; also the required token audience. */
  resource: string;
  allowedSubjects: string[];
  /** Optional allow-list of OAuth client ids (client_id / azp). Empty: any client Identity approved. */
  allowedClients: string[];
  jwksFile: string;
}

export interface Config {
  port: number;
  host: string;
  deployed: boolean;
  /** Origin of the UI, e.g. https://heyann.example.ts.net. Null locally. */
  publicOrigin: string | null;
  /** Exact Host header values the UI listener accepts (localhost variants are always accepted). */
  allowedHosts: string[];
  trustedProxies: string[];
  /** Peers whose X-Forwarded-Proto the MCP listener believes: IPs or CIDRs (in-cluster callers like the Orbit Hub). Defaults to trustedProxies. */
  mcpTrustedProxies: string[];
  credentialFile: string | null;
  /** Separate MCP listener port (deployed: required for MCP). Null: MCP on the UI listener with the local token. */
  mcpPort: number | null;
  mcpPublicOrigin: string | null;
  /** Browser origins allowed to call /mcp (requests without Origin are always allowed). */
  mcpAllowedOrigins: string[];
  oauth: OAuthConfig | null;
  /** Study-rewards intake listener (Socrates' signed pushes) and Socrates' public keys. Both or neither. */
  rewardsPort: number | null;
  rewardsJwksFile: string | null;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function httpsOrigin(value: string, name: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (u.protocol !== 'https:') throw new Error(`${name} must use https`);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw new Error(`${name} must be a bare origin like https://host`);
  return u.origin;
}

function port(value: string | undefined, name: string, fallback: number | null): number | null {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicOrigin = env.HEYANN_PUBLIC_ORIGIN ? httpsOrigin(env.HEYANN_PUBLIC_ORIGIN, 'HEYANN_PUBLIC_ORIGIN') : null;
  const deployed = publicOrigin !== null;
  const allowedHosts = [...new Set([...(publicOrigin ? [new URL(publicOrigin).host] : []), ...list(env.HEYANN_ALLOWED_HOSTS)])];
  for (const h of allowedHosts) if (!/^[a-z0-9.-]+(:\d+)?$/i.test(h) || h.includes('*')) throw new Error(`HEYANN_ALLOWED_HOSTS: "${h}" is not an exact host name`);

  const credentialFile = env.HEYANN_CREDENTIAL_FILE || null;
  if (deployed && !credentialFile) throw new Error('A deployed Hey Ann needs the owner password: set HEYANN_CREDENTIAL_FILE.');

  const mcpPort = port(env.HEYANN_MCP_PORT, 'HEYANN_MCP_PORT', null);
  const uiPort = port(env.PORT, 'PORT', 4321)!;
  if (mcpPort !== null && mcpPort === uiPort) throw new Error('HEYANN_MCP_PORT must differ from PORT.');

  let oauth: OAuthConfig | null = null;
  if (env.HEYANN_OAUTH_ISSUER) {
    const issuer = env.HEYANN_OAUTH_ISSUER;
    if (!/^https:\/\/[^/?#]+\/$/.test(issuer)) throw new Error('HEYANN_OAUTH_ISSUER must be the exact https issuer, ending in "/"');
    const resource = env.HEYANN_OAUTH_RESOURCE ?? '';
    const r = (() => { try { return new URL(resource); } catch { return null; } })();
    if (!r || r.protocol !== 'https:' || r.pathname !== '/mcp' || r.search || r.hash) throw new Error('HEYANN_OAUTH_RESOURCE must be the https URL of /mcp');
    const allowedSubjects = list(env.HEYANN_OAUTH_ALLOWED_SUBJECTS);
    if (allowedSubjects.length === 0) throw new Error('HEYANN_OAUTH_ALLOWED_SUBJECTS must name the owner subject.');
    if (!env.HEYANN_OAUTH_JWKS_FILE) throw new Error('HEYANN_OAUTH_JWKS_FILE is required with HEYANN_OAUTH_ISSUER.');
    if (mcpPort === null) throw new Error('OAuth MCP runs on its own listener: set HEYANN_MCP_PORT.');
    oauth = { issuer, resource: r.href, allowedSubjects, allowedClients: list(env.HEYANN_OAUTH_ALLOWED_CLIENTS), jwksFile: env.HEYANN_OAUTH_JWKS_FILE };
  }

  const mcpPublicOrigin = env.HEYANN_MCP_PUBLIC_ORIGIN ? httpsOrigin(env.HEYANN_MCP_PUBLIC_ORIGIN, 'HEYANN_MCP_PUBLIC_ORIGIN') : null;
  if (oauth && !mcpPublicOrigin) throw new Error('HEYANN_MCP_PUBLIC_ORIGIN is required with HEYANN_OAUTH_ISSUER.');
  if (oauth && new URL(oauth.resource).origin !== mcpPublicOrigin) throw new Error('HEYANN_OAUTH_RESOURCE must be on HEYANN_MCP_PUBLIC_ORIGIN.');
  if (mcpPort !== null && !oauth) throw new Error('HEYANN_MCP_PORT is only for OAuth MCP: also set HEYANN_OAUTH_ISSUER and the other HEYANN_OAUTH_* settings.');
  const mcpAllowedOrigins = list(env.HEYANN_MCP_ALLOWED_ORIGINS).map((o) => httpsOrigin(o, 'HEYANN_MCP_ALLOWED_ORIGINS'));

  const trustedProxies = list(env.HEYANN_TRUSTED_PROXY);
  for (const p of trustedProxies) if (!isIP(p)) throw new Error(`HEYANN_TRUSTED_PROXY: "${p}" is not an IP address`);
  if ((deployed || oauth) && trustedProxies.length === 0)
    throw new Error('Set HEYANN_TRUSTED_PROXY to the address of the HTTPS proxy (tailscale serve / cloudflared).');
  const mcpTrustedProxies = env.HEYANN_MCP_TRUSTED_PROXY ? list(env.HEYANN_MCP_TRUSTED_PROXY) : trustedProxies;
  for (const p of mcpTrustedProxies) if (!isIpOrCidr(p)) throw new Error(`HEYANN_MCP_TRUSTED_PROXY: "${p}" is not an IP address or CIDR`);
  if (env.HEYANN_MCP_TRUSTED_PROXY && mcpPort === null) throw new Error('HEYANN_MCP_TRUSTED_PROXY is only for the separate MCP listener (HEYANN_MCP_PORT).');

  const rewardsPort = env.HEYANN_REWARDS_PORT ? Number(env.HEYANN_REWARDS_PORT) : null;
  if (rewardsPort !== null && (!Number.isInteger(rewardsPort) || rewardsPort < 1 || rewardsPort > 65535)) throw new Error('HEYANN_REWARDS_PORT must be a port number.');
  const rewardsJwksFile = env.HEYANN_REWARDS_JWKS_FILE || null;
  if ((rewardsPort === null) !== (rewardsJwksFile === null)) throw new Error('Set HEYANN_REWARDS_PORT and HEYANN_REWARDS_JWKS_FILE together.');
  if (rewardsPort !== null && (rewardsPort === uiPort || rewardsPort === mcpPort)) throw new Error('HEYANN_REWARDS_PORT must be its own port.');

  return {
    port: uiPort,
    host: env.HOST ?? '127.0.0.1',
    deployed,
    publicOrigin,
    allowedHosts,
    trustedProxies,
    mcpTrustedProxies,
    credentialFile,
    mcpPort,
    mcpPublicOrigin,
    mcpAllowedOrigins,
    oauth,
    rewardsPort,
    rewardsJwksFile,
  };
}

/** "10.42.0.1", "fd00::1", "10.42.0.0/16", "fd00::/64". */
export function isIpOrCidr(v: string): boolean {
  const [ip, bits, extra] = v.split('/');
  const fam = isIP(ip);
  if (!fam || extra !== undefined) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (fam === 4 ? 32 : 128);
}

/** Matches a peer address (IPv4-mapped IPv6 included) against IPs and CIDRs. */
export function addressMatcher(list: string[]): (ip: string) => boolean {
  const bl = new BlockList();
  for (const v of list) {
    const [ip, bits] = v.split('/');
    const type = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) bl.addAddress(ip, type);
    else bl.addSubnet(ip, Number(bits), type);
  }
  return (ip) => {
    const a = ip.replace(/^::ffff:/i, '');
    const fam = isIP(a);
    return !!fam && bl.check(a, fam === 6 ? 'ipv6' : 'ipv4');
  };
}

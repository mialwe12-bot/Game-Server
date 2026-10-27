import * as client from 'openid-client';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';

export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified: boolean;
  username?: string;
  name?: string;
  groups: string[];
}

/** Optionales Single Sign-On über OpenID Connect (z. B. Authentik, Keycloak, Authelia). */
export class OidcService {
  private configuration: Promise<client.Configuration> | null = null;

  constructor(private readonly ctx: AppContext) {}

  get enabled(): boolean {
    return !!(this.ctx.config.OIDC_ISSUER && this.ctx.config.OIDC_CLIENT_ID);
  }

  get redirectUri(): string {
    return new URL('/api/auth/oidc/callback', this.ctx.config.PUBLIC_URL).toString();
  }

  private config(): Promise<client.Configuration> {
    if (!this.enabled) throw badRequest('OIDC ist nicht konfiguriert', 'oidc_disabled');
    this.configuration ??= client
      .discovery(new URL(this.ctx.config.OIDC_ISSUER), this.ctx.config.OIDC_CLIENT_ID, this.ctx.config.OIDC_CLIENT_SECRET || undefined)
      .catch((err) => {
        this.configuration = null;
        throw err;
      });
    return this.configuration;
  }

  async start(): Promise<{ url: string; state: string; verifier: string }> {
    const config = await this.config();
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: this.redirectUri,
      scope: this.ctx.config.OIDC_SCOPES,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
    });
    return { url: url.toString(), state, verifier };
  }

  async callback(currentUrl: URL, state: string, verifier: string): Promise<OidcClaims> {
    const config = await this.config();
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: verifier,
      expectedState: state,
    });
    const claims = tokens.claims();
    if (!claims) throw badRequest('Kein ID-Token erhalten', 'oidc_failed');
    let info: Record<string, unknown> = { ...claims };
    try {
      info = { ...info, ...(await client.fetchUserInfo(config, tokens.access_token, claims.sub)) };
    } catch {
      // Userinfo ist optional
    }
    const groups = Array.isArray(info.groups) ? info.groups.map(String) : [];
    return {
      sub: claims.sub,
      email: typeof info.email === 'string' ? info.email : undefined,
      emailVerified: info.email_verified === true || info.email_verified === 'true',
      username: typeof info.preferred_username === 'string' ? info.preferred_username : undefined,
      name: typeof info.name === 'string' ? info.name : undefined,
      groups,
    };
  }
}

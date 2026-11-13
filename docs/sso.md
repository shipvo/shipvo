# Single sign-on (OIDC)

People sign in to the dashboard with your identity provider and get the role their claims map to. This page is for the person who runs the control plane and has access to the identity provider. You will set up OIDC or SAML, and people will sign in with the company account they already use.

## Set it up

1. Choose a short org name, for example `acme`. It appears in the sign-in links.
2. At your identity provider, register the control plane. For OIDC, register `https://<control-plane>/sso/<org>/callback` as the redirect URI. For SAML, open `https://<control-plane>/saml/<org>/metadata` and give the entity id and ACS URL to the provider.
3. Store the client secret (OIDC) as a Worker secret and set `SSO_ORGS` (OIDC) or `SAML_ORGS` (SAML), as shown below.
4. Open `https://<control-plane>/sso/<org>/start` (or `/saml/<org>/start`). After you sign in, both OIDC and SAML return `{ "ok": true, "org": ..., "role": ..., "email": ..., "expires_at": ... }`.

## Routes

- `GET /sso/<org>/start` redirects to the provider with `state`, `nonce` and a PKCE challenge (S256).
- `GET /sso/<org>/callback` checks the state, exchanges the code, verifies the ID token, maps the claims to a role and creates a session.

The session is an HTTP-only `sv_sso` cookie that lasts 8 hours. The response is `{ ok, org, role, email, expires_at }`.

Each sign-in link works once. A reused link, a mismatched state, an unknown org, a wrong audience or a person with no mapped role gets a plain message and no session.

## Configuration

Set `SSO_ORGS` on the control plane to a JSON object keyed by org:

```json
{
  "acme": {
    "issuer": "https://idp.acme.com",
    "clientId": "shipvo",
    "jwksUri": "https://idp.acme.com/jwks",
    "authorizationEndpoint": "https://idp.acme.com/authorize",
    "tokenEndpoint": "https://idp.acme.com/token",
    "secretRef": "ACME_SSO_SECRET",
    "mapping": { "groups": { "shipvo-admins": "admin" }, "emailDomains": { "acme.com": "viewer" } }
  }
}
```

`secretRef` names a Worker secret that holds the client secret. The secret is never in `SSO_ORGS`, logs or responses. Register `https://<control-plane>/sso/<org>/callback` as the redirect URI at the provider.

## SAML

Companies that sign in with a SAML identity provider use the same sessions and roles.

- `GET /saml/<org>/start` sends the person to the identity provider with an AuthnRequest. The request id works once and expires after 10 minutes.
- `POST /saml/<org>/acs` takes the signed response, checks it against the request, maps the attributes to a role and creates the same `sv_sso` session as the OIDC login.
- `GET /saml/<org>/metadata` returns the entity id (`https://<control-plane>/saml/<org>`) and the ACS URL (`https://<control-plane>/saml/<org>/acs`). Give both to the identity provider.

Set `SAML_ORGS` on the control plane to a JSON object keyed by org:

```json
{
  "acme": {
    "issuer": "https://idp.acme.com/metadata",
    "audience": "https://<control-plane>/saml/acme",
    "certificate": "-----BEGIN CERTIFICATE-----...",
    "ssoUrl": "https://idp.acme.com/sso",
    "mapping": { "groupClaim": "groups", "groups": { "shipvo-admins": "admin" } }
  }
}
```

`certificate` is the identity provider's signing certificate. The `mapping` works as in the OIDC section. A response with the wrong issuer or audience, an expired or reused assertion, a bad signature, or an unknown or missing request id gets a plain message and no session.

## Troubleshooting

- **"Single sign-on is not set up for this organization"** (or the SAML version): the org name in the link is not a key in `SSO_ORGS` or `SAML_ORGS`. Check the spelling.
- **"Your account has no role in Shipvo. Ask an admin."**: no group or email domain in `mapping` matches this person. Add the group or domain, then sign in again.
- **"The sign-in state does not match" or "already used or has expired"**: each sign-in link works once, and a SAML request lasts 10 minutes. Start again from `/start`.
- **"The identity provider refused the sign-in code"**: the code was used already, or the redirect URI at the provider is not exactly the callback URL above.
- **"The ID token was not accepted (...)"** or **"The sign-in response was not accepted (...)"**: the reason in brackets names the check that failed, such as the issuer, the audience, the expiry or the signature. Compare `issuer`, `audience` and `certificate` with the provider's values.
- **"Start the sign-in from Shipvo, not from the identity provider"** (SAML): open `/saml/<org>/start` rather than the tile in the provider's app list.

## Next steps

- [Self-hosting](self-hosting.md) to deploy the control plane.
- [Threat model](threat-model.md) for how sessions and tokens are protected.

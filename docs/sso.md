# Single sign-on (OIDC)

People sign in to the dashboard with your identity provider and get the role their claims map to.

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

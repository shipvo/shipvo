# Network calls on the hosted phone

The hosted phone sends an app's HTTP calls through a request proxy on the control plane, so the browser applies no CORS rules. It works the same on the Android and iOS skins.

## Declare your hosts

List the hosts your app calls in `shipvo.json`:

```json
{ "network": { "allow": ["api.example.com", "*.cdn.example.com"] } }
```

- A name matches that host only. `*.example.com` matches any subdomain, not `example.com` itself.
- No scheme, port, path or IP address. `@shipvo/schema` validates the field (`parseNetwork`).
- Owners store the list for the hosted phone with the `set_network_allow` command (owner sign-in only).

## What the proxy checks

- The caller has a signed-in session.
- The host is on the app's list, on every redirect as well.
- Every address the host resolves to is public. Private, loopback, link-local and cloud metadata addresses are refused, also when a redirect points there.
- Ports 80 and 443 only, no credentials in the URL.
- Request size, response size, time and request rate are limited per session. Usage quotas apply.
- Hop-by-hop headers are removed. Shipvo session tokens and cookies are never forwarded. A site's `Set-Cookie` is not passed back.

Every request, allowed or refused, is recorded in `device_log` with the app, host, path (no query string), status and the reason for a refusal. A refused call answers with a JSON `error` and the `x-shipvo-net-error` header.

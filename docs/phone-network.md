# Network calls on the hosted phone

The hosted phone sends an app's HTTP calls through a request proxy on the control plane, so the browser applies no CORS rules. It works the same on the Android and iOS skins.

## Allowed hosts

The proxy only reaches the hosts on the app's allow-list. The owner stores the list with the `set_network_allow` command (owner sign-in only), for example:

```json
["api.example.com", "*.cdn.example.com"]
```

- A name matches that host only. `*.example.com` matches any subdomain, not `example.com` itself.
- No scheme, port, path or IP address. A bad entry is refused with `bad_param` and nothing is stored.
- `@shipvo/schema` exports the same validation (`parseNetwork`).

## What the proxy checks

- The caller has a signed-in session.
- The host is on the app's list, on every redirect as well.
- Every address the host resolves to is public. Private, loopback, link-local and cloud metadata addresses are refused, also when a redirect points there.
- Ports 80 and 443 only, no credentials in the URL.
- Request size, response size, time and request rate are limited per session. Usage quotas apply.
- Hop-by-hop headers are removed. Shipvo session tokens and cookies are never forwarded. A site's `Set-Cookie` is not passed back.
- An `authorization` header your app sends is forwarded to the declared host. It is dropped if a redirect leaves that host.

Every request from a signed-in session, allowed or refused, is recorded in `device_log` with the app, host, path (no query string), status and the reason for a refusal. A refused call answers with a JSON `error` and the `x-shipvo-net-error` header.

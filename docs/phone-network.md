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

## Network profiles

Run the same flow under different network conditions. A profile sets how long each `fetch` and XHR call waits and how often it fails. The numbers are simulation settings, not measurements of a real network.

| Profile | Latency per request | Download rate | Calls that fail |
| --- | --- | --- | --- |
| `online` | 0 ms | unlimited | 0% |
| `offline` | 0 ms | none | 100% |
| `2g` | 800 ms | 50 kbps | 2% |
| `3g` | 300 ms | 750 kbps | 1% |
| `slow-4g` | 150 ms | 1,600 kbps | 0% |
| `spotty` | 400 ms | 500 kbps | 30% |
| `low-end-4g` | 100 ms | 6,300 kbps | 0.5% |

Works the same on the Android and iOS skins.

### In a `@shipvo/test` test

```ts
import { test, expect } from "@shipvo/test/vitest";

test("shows an error when offline", async ({ phone }) => {
  await phone.setNetwork("offline");
  await phone.tap("Load items");
  await phone.waitFor("Could not load items");
  expect(await phone.getNetwork()).toBe("offline");

  await phone.setNetwork("online");
  await phone.tap("Load items");
  await phone.waitFor("Items loaded");
});
```

`setNetwork` throws a `PhoneError` with code `unknown_profile` for a name that is not in the table. Mock rules from `phone.mockNetwork` still answer under any profile.

### Over MCP

- `set_network_profile { session, profile }` switches the profile. An unknown name fails with `unknown_profile`.
- `get_network_profile { session }` returns the current name.

Each change is recorded in `device_log` as simulated.

### In `phone.json`

```json
{ "network": "slow-4g" }
```

The phone starts with that profile. An unknown name fails the session with `bad_profile` and says which names exist.

## Troubleshooting

Every refused call answers with JSON `{ "error": "<code>" }` and the same code in the `x-shipvo-net-error` header. Look the code up in `device_log`.

| Code | Status | What it means and what to do |
| --- | --- | --- |
| `unauthorized` | 401 | The session is not signed in. Sign in, then try again. |
| `host_not_allowed` | 403 | The host is not on the app's allow-list. Ask the owner to add it with `set_network_allow`. `*.example.com` does not match `example.com` itself, so list both. |
| `blocked_address` | 403 | The host is, or resolves to, a private, loopback, link-local or metadata address. Use a public host. |
| `port_not_allowed` | 403 | Only ports 80 and 443 are open. Drop the port from the URL. |
| `credentials_in_url` | 400 | Remove `user:password@` from the URL and send an `authorization` header instead. |
| `bad_scheme` | 400 | Use an `https:` URL. |
| `rate_limited` | 429 | Too many requests from this session. Wait the `retry-after` seconds in the reply. |
| `request_too_large`, `response_too_large` | 413 | The body went over the size limit for a call. Send or fetch less per request. |
| `too_many_redirects`, `bad_redirect` | 502 | The server redirected too often, or to a URL that is not valid. Call the final URL. |
| `dns_failed`, `upstream_failed` | 502 | The host did not resolve or did not answer. Check the name, then retry. |
| `timeout` | 504 | The server took too long. Retry, or check that it answers. |
| `unknown_profile` | none | The profile name is not one of the profiles above. Use `online`, `offline`, `2g`, `3g`, `slow-4g`, `spotty` or `low-end-4g`. |
| `bad_profile` | none | `network` in `phone.json` is not one of those names. Fix the name; the error lists the valid ones. |

If an `authorization` header goes missing after a redirect, the redirect left the declared host. Call the final host directly and list it.

## Next steps

- [Device API](device-api.md#network-profiles): the same profiles from the device API.
- [Phone apps](phone-apps.md): data sources that call a host through this proxy.
- [Testing](testing.md): write the offline and slow-network checks as typed tests.

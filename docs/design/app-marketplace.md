# The Shipvo app marketplace

For developers who publish apps and for the team that builds the Store. You will learn how an app gets from a developer's machine, or from a chat with an assistant, into the Store on Android and iOS phones, and how the same path works in the Shipvo simulator.

## What exists

Source: [`services/control-plane/src/apps.ts`](../../services/control-plane/src/apps.ts).

- **Register and publish.** `shipvo app create` registers an app under a GitHub-signed-in account and returns a scoped publish token. `shipvo publish` writes signed releases for that app only. Every release pointer is checked against the app's registered public key, so the private key never leaves the developer.
- **Listing.** An app sets `listed` with a name, tagline, description, category and website. A listed app appears in the public directory only after review sets `approved`. Taking an app off the list (`listed` off) clears approval; editing its text keeps it.
- **Public directory.** `GET /apps/public` lists approved apps that have a release, and `GET /apps/public/:id` shows one with similar apps. Both answer with CORS open, so a page on any origin can read them.
- **Review queue.** `GET /apps/review` and `POST /apps/review/:id` let the owner approve or reject a listing. Both take the owner token only; the reject call stores no reason.
- **Web artifact.** Each release also publishes a web build at `/w/<app>/r<N>/index.html`, served with CORS open. The simulator and `shipvo run` load it.
- **Real install on the phone.** The Store screen and the `install_app` tool fetch that web build, keep its `sha256` and size, and log the install as `source: "real"`. See [phone-apps](../phone-apps.md).

## Declarative apps

An app can be a **spec**: one JSON document described in [app-spec](app-spec.md), run by the Shipvo engine. A spec has no build step and no native code, so it is the easiest app to list.

Submission of a spec app uses the same publish path as any other app:

1. The assistant (or the developer) writes the spec and calls the validator. The validator returns errors with a JSON path and a fix.
2. `shipvo publish` signs the spec as a release. The release is delivered with the same staged rollout and rollback as any Shipvo update.
3. The control plane stores the release and the web artifact. The spec is data, so the Store entry can show exactly what the app is allowed to do: its declared network domains, permissions and schedules.

Code islands (level 2 in the app spec) run inside the engine's sandbox. A listing with islands goes to human review before `approved`; a pure spec passes the validator and the automated checks in step 1 of the plan.

## Submission flow

| Step | Who | What happens |
| --- | --- | --- |
| 1. Create | Developer | `shipvo app create <id>` registers the app and returns a publish token. |
| 2. Describe | Developer | Name, tagline, description, category and website go into the listing. |
| 3. Publish | Developer or CI | `shipvo publish` uploads a signed release and its web artifact. |
| 4. Review | Owner | The listing appears in the review queue. The owner approves or rejects. |
| 5. Listed | Everyone | The app shows in `/apps/public` and in the Store on every phone. |
| 6. Update | Developer | A new release repeats steps 3 and 4 for the changes. Taking an app off the list clears approval. |

## One path for people and agents

Every step above is available as an HTTP call, so a script or an assistant can create, publish and submit an app without a human at a keyboard. The human steps are the developer's sign-in and the owner's review: the review endpoints accept the owner token only, so a script or assistant cannot approve.

## Plan

Each step ships as its own small change and issue.

1. **Automated checks.** Every release is checked when it is published: the signature matches the registered key, the web artifact loads, the declared domains and permissions match what the app uses, a spec passes the validator, and the bundle is under the size cap. Results are stored with the release.
2. **Submission status.** `shipvo app status` shows a release's checks and review state, and a rejected listing carries the reason.
3. **Check results in the review queue.** The queue shows the validator and permission results next to each listing.
4. **Spec apps in the Store.** A spec app installs in the simulator Store the same way as a web build: the install fetches the spec, validates it and keeps its hash.
5. **Screenshots from the simulator.** `shipvo publish` captures Android and iOS screenshots for the listing from the simulator in CI.
6. **Updates on installed apps.** The phone Store shows an Update button when a newer approved release exists, and installs it with the same hash check.
7. **MCP tools.** Create, publish and submit each get an MCP tool, so an assistant can run the whole flow up to the owner's review.
8. **Player app.** The Shipvo player app on real Android and iOS phones installs the same listings.

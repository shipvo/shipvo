import { z, type ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Tool annotations (MCP hints): clients use them to decide what to run without asking.
const RO = { readOnlyHint: true, destructiveHint: false };
const WR = { readOnlyHint: false, destructiveHint: false };
const DEST = { readOnlyHint: false, destructiveHint: true };
const OPEN_WORLD = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

// True when a wait_for object says what to wait for.
export const wantsMatch = (w: { ref?: string; text?: string; role?: string; name?: string }) => !!(w.ref || w.text || (w.role && w.name));

const sid = z.string().describe("Session from open_app");
const compact = z.boolean().optional().describe("When the change is 'content changed', return only the added/removed lines, not the whole screen");
const CH = " The result starts with 'Change: none | content changed | new screen | scrolled'.";
const ASYNC = " Work that starts on a tap (paying, saving, loading) can finish after this returns, so the screen may show 'Paying...' or a spinner. Do not report that as the result: pass wait_for with the text you expect (and gone: true for the spinner), or settle: true, before you read the outcome or do anything else.";
const waitFor = z.object({ ref: z.string().regex(/^e\d+$/).optional(), text: z.string().optional(), role: z.string().optional(), name: z.string().optional(), gone: z.boolean().optional() })
  .refine((w) => wantsMatch(w), "give ref, text, or role and name").optional()
  .describe("Use after any action that starts work. Wait until this appears (a ref, a text, or role+name), or disappears with gone: true. The result says Waited: matched or timed out.");
const timeoutMs = z.number().int().min(0).max(30000).optional().describe("How long wait_for and settle may take, in ms (default 2000)");
const settle = z.boolean().optional().describe("Wait until the screen stops changing (two equal reads 100 ms apart), up to timeout_ms. Use after any action that starts work. A slow result can still follow a pause, so prefer wait_for when you know the expected text.");
const ref = z.string().regex(/^e\d+$/).describe("Element ref from the screen, e.g. e42");
const bref = z.string().regex(/^(?:f\d+)?e\d+$/).describe("Element ref from browser_snapshot, e.g. e12 or f1e12");

export type ToolDef<S extends ZodRawShape = ZodRawShape> = {
  readonly name: string;
  readonly description: string;
  /** Input shape (zod). The JSON Schema in the tool list is made from it. */
  readonly input: S;
  readonly annotations: { readonly readOnlyHint: boolean; readonly destructiveHint: boolean; readonly openWorldHint?: boolean; readonly title?: string; readonly idempotentHint?: boolean };
  /** Codes this tool can fail with (result text "Error [code]"). Codes the simulator returns for any action are not repeated here. */
  readonly errorCodes: readonly string[];
  /** True when the tool can return a plan that a person must approve first (an agent cannot approve it). */
  readonly needsApproval: boolean;
  /** JSON Schema of the result. Not set yet: results are text or images and no tool declares one. */
  readonly outputSchema?: Record<string, unknown>;
};
const def = <S extends ZodRawShape>(name: string, description: string, input: S, annotations: ToolDef["annotations"], errorCodes: readonly string[] = [], needsApproval = false): ToolDef<S> =>
  ({ name, description, input, annotations, errorCodes, needsApproval });

export const tools = {
  list_apps: def("list_apps", "Apps this server can open, with what each one does. Optional query filters by name, description or category (e.g. 'shop', 'douala').", { query: z.string().optional() }, RO, []),
  open_app: def("open_app", "Open an app in a fresh phone-sized session and return its first screen.", {
  app: z.string().describe("App id from list_apps, optionally with a release: 'tide' (local build), 'tide@latest' or 'tide@r13' (the published release phones run)"),
  session: z.string().optional().describe("Session name (default: generated). One session is one phone."),
  seed_cart: z.array(z.object({ product_id: z.string().optional(), id: z.string().optional(), quantity: z.number().int().positive().optional(), qty: z.number().int().positive().optional() }).refine((l) => (l.product_id ?? l.id) && (l.quantity ?? l.qty), "each line needs product_id (or id) and quantity (or qty)")).optional().describe("Start with these items already in the cart (test shortcut). Each line: { product_id, quantity }; { id, qty } also works."),
  dark: z.boolean().optional().describe("Dark mode"),
  attach: z.enum(["auto", "never", "always"]).optional().describe("'auto' (default): drive the phone of a live `shipvo run` in this project if there is one, else a headless session. 'never': always headless. 'always': error if there is no live `shipvo run`."),
}, WR, ["attach_failed","no_live_run","unknown_app"]),
  attach_session: def("attach_session", "Attach to the phone of a live `shipvo run` in this project (read from .shipvo/run.json) and return its screen. The person sees every action in their browser. Same as open_app with attach: 'always', without needing the app id.", {
  app: z.string().optional().describe("App id; default: the app of the live run"),
  session: z.string().optional().describe("Session name (default: generated)"),
}, WR, ["attach_failed","no_live_run"]),
  list_sessions: def("list_sessions", "Open simulator sessions (phones) on this server: id, app, release and when each started. Use to resume after a reconnect.", {}, RO, []),
  screen: def("screen", "The current screen as an accessibility tree with refs.", { session: sid }, RO, []),
  tap: def("tap", "Tap a button, link or choice by ref. Returns the new screen." + CH + ASYNC, { session: sid, ref, compact, wait_for: waitFor, timeout_ms: timeoutMs, settle }, WR, []),
  type: def("type", "Type into a text field by ref (replaces its content). Returns the new screen." + CH + " Also gives the field's value after typing.", { session: sid, ref, text: z.string(), enter: z.boolean().optional().describe("Press Enter afterwards"), compact, wait_for: waitFor, timeout_ms: timeoutMs, settle }, WR, []),
  scroll: def("scroll", "Scroll the page (down/up) or a horizontal rail (right/left, give the rail's ref). Returns the new screen." + CH, { session: sid, direction: z.enum(["down", "up", "left", "right"]), ref: ref.optional().describe("Scroll inside this element (a rail or list); omit for the page"), compact, wait_for: waitFor, timeout_ms: timeoutMs, settle }, WR, []),
  back: def("back", "Go back one screen." + CH, { session: sid, compact, wait_for: waitFor, timeout_ms: timeoutMs, settle }, WR, []),
  screenshot: def("screenshot", "A PNG of the phone screen (for checking layout, colours, images). The result says `source`: tab-capture (the person's live tab), rendered (the page drawn to an image; it lists what it could not draw) or headless. The tree from `screen` is usually enough to act.", { session: sid }, RO, []),
  set_device: def("set_device", "Change what the simulated phone has: location, the address book (contacts), calendar events, files for the file picker, a barcode in front of the camera, permission states, whether the fingerprint will match, whether a payment will be approved, network on/off. Takes effect for the next action.", {
  session: sid,
  location: z.object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().optional() }).optional(),
  camera: z.object({ barcode: z.object({ type: z.string(), data: z.string() }).nullable().optional(), delayMs: z.number().optional() }).optional(),
  permissions: z.object({ camera: z.enum(["granted", "denied", "undetermined"]).optional(), location: z.enum(["granted", "denied", "undetermined"]).optional(), notifications: z.enum(["granted", "denied", "undetermined"]).optional(), contacts: z.enum(["granted", "denied", "undetermined"]).optional(), calendar: z.enum(["granted", "denied", "undetermined"]).optional() }).optional(),
  contacts: z.array(z.object({ id: z.string(), name: z.string(), phoneNumbers: z.array(z.string()).optional(), emails: z.array(z.string()).optional() })).optional().describe("Replace the address book the app can read (needs contacts permission)"),
  calendar: z.array(z.object({ id: z.string(), title: z.string(), start: z.string().describe("ISO 8601"), end: z.string().describe("ISO 8601"), allDay: z.boolean().optional(), location: z.string().optional(), notes: z.string().optional() })).optional().describe("Replace the calendar events the app can read (needs calendar permission)"),
  files: z.array(z.object({ name: z.string(), mimeType: z.string(), content: z.string().describe("The file's text") })).optional().describe("Replace the files the file picker offers"),
  biometrics: z.object({ enrolled: z.boolean().optional(), nextResult: z.enum(["success", "fail", "cancel"]).optional() }).optional(),
  payment: z.object({ nextResult: z.enum(["approve", "decline", "timeout", "insufficient_funds"]).optional(), pin: z.string().optional() }).optional(),
  online: z.boolean().optional(),
  wifi: z.boolean().optional(), mobileData: z.boolean().optional(), airplane: z.boolean().optional(), locationServices: z.boolean().optional(), darkMode: z.boolean().optional().describe("The app's colour scheme (prefers-color-scheme)"), dnd: z.boolean().optional().describe("Do Not Disturb: notifications go to the shade without a banner"), autoRotate: z.boolean().optional(), flashlight: z.boolean().optional(), orientationLock: z.boolean().optional(), brightness: z.number().min(0).max(100).optional(),
  source: z.enum(["auto", "simulated"]).optional().describe("\"simulated\" forces the simulated camera, microphone and location even when a person could grant the real ones, for reproducible runs"),
  microphone: z.object({ level: z.number().min(0).max(1).optional() }).optional(),
}, WR, []),
  push_notification: def("push_notification", "Deliver a push notification to the simulated phone; it appears as a banner the agent can tap. The app receives it only if notification permission is granted; otherwise nothing is delivered.", { session: sid, title: z.string(), body: z.string(), data: z.record(z.unknown()).optional() }, WR, []),
  notifications: def("notifications", "The notification shade: notifications delivered to the simulated phone in this session (their banners vanish after 5 s, like a heads-up on a real phone).", { session: sid }, RO, []),
  open_notification: def("open_notification", "Tap a notification from the shade (newest if no id is given): the app handles it exactly as if its banner was tapped.", { session: sid, id: z.string().optional() }, WR, []),
  open_url: def("open_url", "Open a deep link (such as myapp://item/3) in the running app, as a push tap, auth callback or share link would. Fails with no_url_listener if the app does not listen for URLs.", { session: sid, url: z.string().describe("The URL to deliver, e.g. myapp://item/3") }, { title: "Open a deep link", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, ["no_url_listener"]),
  lock: def("lock", "Press the power button: the simulated phone locks and shows the lock screen. The app and its screen are kept. While locked, tap, type, scroll and back fail with phone_locked. Logged in device_log as simulated.", { session: sid }, WR, []),
  unlock: def("unlock", "Swipe up on the lock screen. Returns to the same screen as before the lock. Fails with not_locked if the phone is not locked. Logged in device_log as simulated.", { session: sid }, WR, ["not_locked"]),
  restart: def("restart", "Restart the simulated phone from the power menu: a boot screen, then the app starts fresh (cold start). Storage is kept. Returns the first screen. Logged in device_log as simulated.", { session: sid }, WR, []),
  open_notifications: def("open_notifications", "Pull down from the top. Android: the first call opens the notification shade (a few quick-settings tiles and the notifications); a second call expands all tiles. iPhone: opens Notification Center (grouped by app). Returns the tiles and notifications.", { session: sid, expand: z.boolean().optional().describe("Android: go straight to all tiles") }, WR, []),
  open_control_center: def("open_control_center", "iPhone only: swipe down from the top right to open Control Center (airplane, Wi-Fi, mobile data, focus, orientation lock, brightness, dark mode). Android fails with no_control_center: use open_notifications.", { session: sid }, WR, ["no_control_center"]),
  toggle_tile: def("toggle_tile", "Flip a quick-settings tile in the open shade or Control Center. It changes the simulated device like set_device: Wi-Fi and mobile data both off take the network offline, dark_mode changes the app's colour scheme, dnd stops banners. Tiles: wifi, mobile_data, airplane, location, dark_mode, dnd, auto_rotate, flashlight (Android); airplane, wifi, mobile_data, focus, orientation_lock, brightness, dark_mode (iPhone). Fails with tile_not_visible if the panel is closed.", { session: sid, tile: z.string(), value: z.union([z.boolean(), z.number()]).optional().describe("true or false; 0 to 100 for brightness. Omit to flip.") }, WR, ["tile_not_visible"]),
  get_settings: def("get_settings", "Read the phone's system settings from the Settings screen: dark_mode, font_size (small, default, large, largest), bold_text, reduce_motion, language (en, fr, ar) and rtl. Returns each setting and the screen as rows.", { session: sid }, RO, []),
  set_setting: def("set_setting", "Change one system setting, as a person would in the phone's Settings screen. The app sees it through Appearance (dark_mode), PixelRatio.getFontScale (font_size), AccessibilityInfo (bold_text, reduce_motion), I18nManager (rtl) and Intl (language). Setting language to ar turns rtl on; en and fr turn it off. Fails with unknown_setting for a key that does not exist and bad_value for a value it does not take. Logged in device_log as simulated.", { session: sid, key: z.string().describe("dark_mode, font_size, bold_text, reduce_motion, language or rtl"), value: z.union([z.boolean(), z.string()]).describe("true or false for switches; small, default, large or largest for font_size; en, fr or ar for language") }, WR, ["bad_value","unknown_setting"]),
  dismiss_notification: def("dismiss_notification", "Swipe a notification away in the open shade (newest if no id), or Clear all with all: true.", { session: sid, id: z.string().optional(), all: z.boolean().optional() }, WR, []),
  close_panels: def("close_panels", "Close the notification shade, Notification Center or Control Center (swipe up).", { session: sid }, WR, []),
  press_home: def("press_home", "Press Home: the app goes to the background (it receives AppState \"background\") and the phone shows the home screen with the app icon. While there, tap, type, scroll and back fail with app_not_foreground. Call resume_app to bring the app back (AppState \"active\"). Logged as simulated.", { session: sid }, WR, []),
  open_recents: def("open_recents", "Open the app switcher: the app goes to the background and its card is shown. resume_app opens the card again; kill_app swipes it away.", { session: sid }, WR, []),
  resume_app: def("resume_app", "Tap the app icon on the home screen, or its card in the app switcher: the app comes back (AppState \"active\") with its screen kept. Fails with app_in_foreground if it is already in front.", { session: sid }, WR, ["app_in_foreground"]),
  kill_app: def("kill_app", "Swipe the app's card away in the app switcher (call open_recents first). The app is killed: the next resume_app is a cold start, with storage kept. Fails with recents_not_open otherwise.", { session: sid }, WR, ["recents_not_open"]),
  list_store_apps: def("list_store_apps", "List the apps in the phone's Store: the marketplace apps from the control plane, each with id, name, bundle url and version. Fails with store_unreachable when the marketplace cannot be reached (nothing is guessed). Install one with install_app.", {}, RO, ["store_unreachable"]),
  install_app: def("install_app", "Install a Store app on the phone, as tapping Install in the Store screen does. The app icon appears on the home screen. Fails with unknown_app (not in the Store) or already_installed. If the marketplace is unreachable the phone's own Store list is used. Logged in device_log as simulated: nothing real is installed.", { session: sid, id: z.string().describe("App id from list_store_apps") }, WR, ["already_installed","unknown_app"]),
  uninstall_app: def("uninstall_app", "Remove an installed app from the phone. If it was open, the phone returns to the home screen. Fails with not_installed. Logged in device_log as simulated.", { session: sid, id: z.string().describe("Installed app id") }, DEST, ["not_installed"]),
  switch_app: def("switch_app", "Open an installed app (tap its icon on the home screen): it becomes current_app and comes to the front. Fails with not_installed. Logged in device_log as simulated.", { session: sid, id: z.string().describe("Installed app id") }, WR, ["not_installed"]),
  get_update_state: def("get_update_state", "The phone's OTA update state: idle, checking, downloading, ready, applied or reverted, the running release, the held release, and the last reason (verify_failed, download_failed or crash_loop). Simulated and logged in device_log.", { session: sid }, RO, []),
  check_for_update: def("check_for_update", "Ask the update source for a newer release: checks its signature and hash and downloads it. Ends in ready, or idle with reason verify_failed or download_failed (the release is never applied). Fails with no_update when nothing newer exists or no source is set. Simulated; each state change is logged in device_log.", { session: sid }, WR, ["no_update"]),
  apply_update: def("apply_update", "Apply the ready release: the app restarts on the new bundle, like restart. After 3 boots that throw, the phone goes back to the old release and the state is reverted with reason crash_loop. Fails with not_ready unless the state is ready. Simulated; logged in device_log.", { session: sid }, WR, ["not_ready"]),
  device_log: def("device_log", "What the app did with the device in this session: permission prompts and answers, location reads, scans, fingerprint checks, payments, notifications, shares.", { session: sid }, RO, []),
  browser_open: def("browser_open", "Open a web page in the phone's Chromium (separate from the app) and return its snapshot. Private hosts (localhost, 127.x, 10.x, 192.168.x, 169.254.x, CGNAT, .local, .internal) are refused with host_not_allowed unless you opt in.", {
  session: sid, url: z.string().describe("http or https URL"),
  allow_private: z.boolean().optional().describe("Allow every private host"), allow_hosts: z.array(z.string()).optional().describe("Allow only these host names"),
}, OPEN_WORLD, ["host_not_allowed"]),
  browser_snapshot: def("browser_snapshot", "The phone browser's page as an accessibility tree with refs, marked source \"web\" (untrusted).", { session: sid }, RO, []),
  browser_click: def("browser_click", "Click an element of the phone browser's page by ref from browser_snapshot. Returns the new snapshot.", { session: sid, ref: bref }, OPEN_WORLD, []),
  browser_type: def("browser_type", "Type into a field of the phone browser's page by ref (replaces its content). Returns the new snapshot.", { session: sid, ref: bref, text: z.string(), enter: z.boolean().optional().describe("Press Enter afterwards") }, OPEN_WORLD, []),
  browser_back: def("browser_back", "Go back one page in the phone browser. Returns the snapshot.", { session: sid }, WR, []),
  browser_tabs: def("browser_tabs", "List the phone browser's tabs (index, url, title, which is active). Titles are untrusted web content.", { session: sid }, RO, []),
  browser_close_tab: def("browser_close_tab", "Close a tab of the phone browser by its index from browser_tabs. Returns the remaining tabs.", { session: sid, index: z.number().int().min(0) }, WR, []),
  browser_scroll: def("browser_scroll", "Scroll the phone browser's page by dy CSS pixels (positive is down) and dx (positive is right). Returns the snapshot.", { session: sid, dy: z.number().min(-5000).max(5000).optional().describe("Default 400"), dx: z.number().min(-5000).max(5000).optional() }, WR, []),
  browser_wait_for: def("browser_wait_for", "Wait until text appears in the phone browser's page, or is gone (gone: true). Fails with code timeout. Returns the snapshot.", { session: sid, text: z.string().min(1).max(200), gone: z.boolean().optional(), timeout_ms: z.number().int().min(100).max(30000).optional().describe("Default 5000") }, RO, ["timeout"]),
  browser_screenshot: def("browser_screenshot", "A PNG of the phone browser's page.", { session: sid }, RO, []),
  device_reset: def("device_reset", "Put the simulated phone back to a known state (permissions undetermined, default location, nothing in front of the camera, log cleared), optionally with a new profile.", { session: sid, platform: z.enum(["android", "ios"]).optional(), api: z.number().optional() }, WR, []),
  export_test: def("export_test", "Turn the steps taken in this session (tap, type, scroll, back, set_device) into a @shipvo/test script and return its source. Read-only. Targets are named by their visible text; ambiguous ones become TODO comments and password fields use an environment variable instead of the typed value.", { session: sid }, RO, ["no_session"]),
  end_session: def("end_session", "Close the session and get a report: steps taken, and the orders the app sent to its backend during the session.", { session: sid }, DEST, ["no_session"]),
  record_start: def("record_start", "Start recording the phone frame to an MP4 under .shipvo/recordings/. Use record_marker for chapters and record_stop to finish.", {
  format: z.enum(["9:16", "16:9", "1:1"]).optional().describe("Video shape (default 9:16: 1080x1920; 16:9 is 1920x1080; 1:1 is 1080x1080)"),
  fps: z.union([z.literal(30), z.literal(60)]).optional().describe("Frames per second (default 30)"),
  title: z.string().optional().describe("Used in the file name"),
  show_taps: z.boolean().optional().describe("Draw a finger dot and ripple on taps and a trail on scrolls (default true)"),
  background: z.string().min(1).optional().describe('Behind the phone: "brand", "plain" (white) or a CSS colour such as "#102030"'),
}, WR, []),
  record_marker: def("record_marker", "Add a chapter at the current time of the running recording.", { caption: z.string().min(1) }, WR, []),
  record_stop: def("record_stop", "Stop the recording and write the MP4. Returns the file, duration in seconds, size and chapters. With music: true, mixes a ducked music bed under the video and writes a credits JSON next to it (credit the track where you publish).", {
  music: z.boolean().optional().describe("Mix a music bed under the video (default false). Needs python3, ffmpeg and ffprobe; picks a track from Jamendo unless SHIPVO_MUSIC_FILE is set."),
  narration: z.string().optional().describe("Path to a wav with a voice track. It is mixed over the video, trimmed to the video length (the result says so), and ducks the music when music is true."),
}, WR, []),
  publish_preview: def("publish_preview", "Build the app in PN_APP_DIR (or the current folder) with the simulated device and publish a shareable web preview to here.now, no account. The link is PUBLIC and expires in 24 hours; claimUrl keeps it. Returns { url, claimUrl, expiresAt }. Needs @shipvo/cli (npx).", {}, { title: "Publish a public preview", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, []),
  owner_describe: def("owner_describe", "List the owner commands of an app (content, prices, offers, orders, publish). Needs PN_OWNER_TOKEN.", { app: z.string() }, RO, []),
  owner_command: def("owner_command", "Run an owner command against the live app (changes are audited). Commands that cannot be undone or reach users (publish, prices, offers, deletes, API keys) do nothing and return { code: \"needs_confirm\", plan } first: show the plan to the owner, then ask the owner to approve the returned challenge in the admin (approval_url). You cannot approve it yourself, and confirm: true alone does nothing. Once approved, call again with the same args and approval: <challenge id>. An approval works once, for 10 minutes, for exactly those args.", { app: z.string(), command: z.string(), args: z.record(z.unknown()).optional(), approval: z.string().optional().describe("Challenge id the owner approved; pass the same args") }, DEST, ["needs_confirm"], true),
  approvals_list: def("approvals_list", "List what waits for an owner. approvals: promotes held above the app's policy band (hold id, release, band, proposer, age). challenges: owner commands waiting for the owner to approve in the admin (id, command, plan, expiry, approval_url). Agents cannot approve either. Needs an owner token.", { app: z.string() }, RO, []),
  approval_approve: def("approval_approve", "Approve a held promote so it goes live. The proposer cannot approve it, and an agent cannot approve an agent's proposal: that is refused with rule self_approval. Ask the owner to approve in that case. Both outcomes are audited.", { app: z.string(), id: z.string().describe("Hold id from approvals_list") }, DEST, ["self_approval"]),
  audit_log: def("audit_log", "Read the app's release audit log, newest first: who (actor) did what (action) to which release (subject) and when (at). Read-only. Needs an owner token.", { app: z.string(), limit: z.number().int().optional().describe("Rows to return (default 50, max 200; values outside are clamped)"), action: z.string().optional().describe("Only rows with this action, for example rollback") }, RO, ["audit_failed","not_found","unauthorized","unreachable"]),
  request_secret: def("request_secret", "Ask the person for an API key without it passing through this chat. Returns a one-time link to the Shipvo vault page (valid 10 minutes, works once) and a notice to show the person. The key goes straight into the vault: you never see it. Tell the person to open the link, then call secret_status to learn whether it was saved. Needs an owner token.", { app: z.string(), name: z.string().describe("Name for the key, e.g. STRIPE_KEY (letters, digits and underscores)"), purpose: z.string().max(200).describe("Why the app needs it, in plain English; shown to the person on the vault page"), service: z.string().min(1).describe("Service name (stripe) or its domain (api.example.com)"), access: z.enum(["read", "write"]).optional().describe("Access the key should have (default read)") }, WR, ["bad_request","bad_service","unauthorized","unreachable","vault_failed"]),
  secret_status: def("secret_status", "Whether a key is saved in the vault, as { saved, valid, access }. Never returns the key. valid is null when it was not checked. Needs an owner token.", { app: z.string(), name: z.string() }, RO, ["bad_request","unauthorized","unreachable","vault_failed"]),
} as const;

/** Every tool, in registration order. */
export const toolList: readonly ToolDef[] = Object.values(tools);

export type ToolInfo = { name: string; description: string; inputSchema: Record<string, unknown>; annotations: ToolDef["annotations"]; errorCodes: readonly string[]; needsApproval: boolean; outputSchema?: Record<string, unknown> };

/** The tool list as plain data: what both MCP servers must show, with JSON Schemas for the input. */
export function describeTools(): ToolInfo[] {
  return toolList.map((t) => {
    const inputSchema = zodToJsonSchema(z.object(t.input), { target: "jsonSchema7" }) as Record<string, unknown>;
    // The MCP SDK leaves additionalProperties out for a tool with no inputs.
    if (Object.keys(t.input).length === 0) delete inputSchema.additionalProperties;
    return { name: t.name, description: t.description, inputSchema, annotations: t.annotations, errorCodes: t.errorCodes, needsApproval: t.needsApproval, ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}) };
  });
}

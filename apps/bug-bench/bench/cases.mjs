// The seeded bugs and the check that shows each one. The screens are in ../src/cases.js under the same ids.
// `check` gets a phone (see core.mjs) with the case already open and resolves true when the app behaves correctly.
// `device` is the simulated hardware state set before the case opens. `platforms` limits a bug that exists on one platform only.

const confirm = async (p) => (await p.tap("Use fingerprint")) || (await p.tap("Use Face ID"));

export const CASES = [
  // App logic
  { id: "cart-total", class: "logic", title: "The total ignores the quantity",
    check: async (p) => { await p.tap("Increase quantity"); await p.tap("Increase quantity"); return p.until("Total: 4500"); } },
  { id: "stale-state", class: "logic", title: "Two state updates in one handler count once",
    check: async (p) => { await p.tap("Add two"); return p.until("Count: 2"); } },
  { id: "delete-wrong-row", class: "logic", title: "Delete removes the last row, not the chosen one",
    check: async (p) => { await p.tap("Delete Bravo"); await p.wait(300); return (await p.sees("Row Alpha")) && (await p.sees("Row Charlie")) && !(await p.sees("Row Bravo")); } },
  { id: "double-submit", class: "logic", title: "A second tap places a second order",
    check: async (p) => { await p.tap("Place order"); await p.tap("Place order"); await p.wait(900); return p.sees("Orders placed: 1"); } },
  { id: "empty-form", class: "logic", title: "An empty email is accepted",
    check: async (p) => { await p.tap("Sign up"); return p.until("Enter your email"); } },
  { id: "inverted-error", class: "logic", title: "The wrong-password message never shows",
    check: async (p) => { await p.type("Password", "nope"); await p.tap("Log in"); return p.until("Wrong password"); } },
  { id: "search-race", class: "logic", title: "A slow older search replaces the newer result",
    check: async (p) => { await p.tap("Search rods"); await p.tap("Search reels"); await p.wait(3200); return p.sees("Results for reels"); } },
  { id: "pagination-repeat", class: "logic", title: "Load more repeats the last row",
    check: async (p) => { await p.tap("Load more"); await p.wait(300); return (await p.count("Row Item 3")) === 1 && (await p.sees("Row Item 6")); } },
  { id: "nav-state-lost", class: "logic", title: "Going back to a step loses what was typed",
    check: async (p) => { await p.type("Your name", "Ada"); await p.tap("Next step"); await p.until("Step 2 of 2"); await p.tap("Previous step"); await p.wait(300); return (await p.value("Your name")) === "Ada"; } },
  { id: "button-stays-disabled", class: "logic", title: "Continue stays disabled after agreeing",
    check: async (p) => { await p.tap("Agree to the terms"); await p.tap("Continue"); return p.until("Account created"); } },
  { id: "render-crash", class: "logic", title: "Opening the profile throws while rendering",
    check: async (p) => { await p.tap("Open profile"); return p.until("City: Douala"); } },
  { id: "wrong-screen", class: "logic", title: "The orders button opens Settings",
    check: async (p) => { await p.tap("Go to orders"); return p.until("Orders screen"); } },

  // Device hardware, set through the simulated device
  { id: "camera-denied", class: "device", title: "A denied camera leaves the scanner spinning", device: { permissions: { camera: "denied" } },
    check: async (p) => { await p.tap("Scan product"); return p.until("Camera access is off"); } },
  { id: "location-denied", class: "device", title: "A denied location leaves the shop finder spinning", device: { permissions: { location: "denied" } },
    check: async (p) => { await p.tap("Find shops"); return p.until("Turn on location"); } },
  { id: "biometric-fail", class: "device", title: "A failed fingerprint still pays", device: { biometrics: { enrolled: true, nextResult: "fail" } },
    check: async (p) => { await p.tap("Pay 4 200 FCFA"); await p.wait(300); await confirm(p); return p.until("Not confirmed"); } },
  { id: "payment-declined", class: "device", title: "A declined payment still places the order", device: { payment: { nextResult: "decline", pin: "1234" } },
    check: async (p) => { await p.tap("Pay now"); return p.until("Payment declined"); } },
  { id: "payment-timeout", class: "device", title: "A payment timeout is treated as paid", device: { payment: { nextResult: "timeout", pin: "1234" } },
    check: async (p) => { await p.tap("Pay now"); return p.until("Payment did not go through"); } },
  { id: "offline-fetch", class: "device", title: "A request made offline never finishes", device: { online: false },
    check: async (p) => { await p.tap("Load offers"); return p.until("You are offline"); } },
  { id: "offline-banner", class: "device", title: "Losing the network does not show the offline banner",
    check: async (p) => { await p.until("Connected"); await p.setDevice({ online: false }); return p.until("No connection"); } },
  { id: "scan-wrong-field", class: "device", title: "The scanner looks the product up by the wrong field",
    device: { permissions: { camera: "granted" }, camera: { barcode: { type: "ean13", data: "6181234567890" }, delayMs: 100 } },
    check: async (p) => { await p.tap("Scan product"); return p.until("Chrome Spoon", 5000); } },

  // Code that runs only on Android and iOS
  { id: "platform-file", class: "native-path", title: "The bug is in a .native.js file",
    check: async (p) => p.until("Price: 1 500 FCFA") },
  { id: "platform-select", class: "native-path", title: "The bug is in the native branch of Platform.select",
    check: async (p) => p.until("Price: 1 500 FCFA") },
  { id: "platform-os-branch", class: "native-path", title: "The bug is in a Platform.OS === \"ios\" branch", platforms: ["ios"],
    check: async (p) => p.until("Button: Checkout") },
];

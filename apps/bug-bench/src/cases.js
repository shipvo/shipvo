// One screen per seeded bug. Each takes `buggy`: true runs the bug, false runs the fix.
// The checks that tell them apart are in bench/cases.mjs, under the same ids.
import { useEffect, useRef, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { device } from "@shipvo/device";
import { Btn, styles } from "./ui";
import { Price, money } from "./Price";

const later = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));

// ---- App logic ----

function CartTotal({ buggy }) {
  const [qty, setQty] = useState(1);
  const price = 1500;
  return (<View style={{ gap: 12 }}>
    <Text>Quantity: {qty}</Text>
    <Btn label="Increase quantity" onPress={() => setQty(qty + 1)} />
    <Text>Total: {buggy ? price : price * qty}</Text>
  </View>);
}

function StaleState({ buggy }) {
  const [count, setCount] = useState(0);
  // Bug: both calls read the same `count`, so two adds become one.
  const addTwo = buggy ? () => { setCount(count + 1); setCount(count + 1); } : () => { setCount((c) => c + 1); setCount((c) => c + 1); };
  return (<View style={{ gap: 12 }}><Text>Count: {count}</Text><Btn label="Add two" onPress={addTwo} /></View>);
}

function DeleteWrongRow({ buggy }) {
  const [rows, setRows] = useState(["Alpha", "Bravo", "Charlie"]);
  const remove = (name) => setRows(buggy ? rows.slice(0, -1) : rows.filter((r) => r !== name));
  return (<View style={{ gap: 12 }}>{rows.map((r) => (
    <View key={r} style={{ gap: 4 }}><Text>Row {r}</Text><Btn label={`Delete ${r}`} onPress={() => remove(r)} /></View>
  ))}</View>);
}

function DoubleSubmit({ buggy }) {
  const [orders, setOrders] = useState(0);
  const [busy, setBusy] = useState(false);
  const place = async () => {
    if (!buggy) { if (busy) return; setBusy(true); }
    await later(300);
    setOrders((n) => n + 1);
  };
  return (<View style={{ gap: 12 }}>
    <Text>Orders placed: {orders}</Text>
    <Btn label="Place order" disabled={!buggy && busy} onPress={place} />
  </View>);
}

function EmptyForm({ buggy }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const submit = () => setMsg(!buggy && !email.trim() ? "Enter your email" : "Thanks, you are signed up");
  return (<View style={{ gap: 12 }}>
    <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} style={styles.input} />
    <Btn label="Sign up" onPress={submit} />
    <Text>{msg}</Text>
  </View>);
}

function InvertedError({ buggy }) {
  const [pw, setPw] = useState("");
  const [state, setState] = useState("idle");
  const wrong = state === "wrong";
  return (<View style={{ gap: 12 }}>
    <TextInput accessibilityLabel="Password" value={pw} onChangeText={setPw} secureTextEntry style={styles.input} />
    <Btn label="Log in" onPress={() => setState(pw === "tide-1234" ? "ok" : "wrong")} />
    {(buggy ? !wrong && state !== "idle" && state !== "ok" : wrong) ? <Text>Wrong password</Text> : null}
    {state === "ok" ? <Text>Welcome back</Text> : null}
  </View>);
}

function SearchRace({ buggy }) {
  const [shown, setShown] = useState("nothing");
  const latest = useRef(0);
  const search = async (term, ms) => {
    const mine = ++latest.current;
    await later(ms);
    if (buggy || mine === latest.current) setShown(term);   // Bug: an older, slower answer replaces the newer one.
  };
  return (<View style={{ gap: 12 }}>
    <Btn label="Search rods" onPress={() => search("rods", 2500)} />
    <Btn label="Search reels" onPress={() => search("reels", 100)} />
    <Text>Results for {shown}</Text>
  </View>);
}

function PaginationRepeat({ buggy }) {
  const all = ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"];
  const [items, setItems] = useState(all.slice(0, 3));
  const more = () => setItems([...items, ...all.slice(buggy ? items.length - 1 : items.length, items.length + 3)]);
  return (<View style={{ gap: 8 }}>{items.map((it, i) => <Text key={i}>Row {it}</Text>)}<Btn label="Load more" onPress={more} /></View>);
}

function StepOne({ name, setName, onNext }) {
  return (<View style={{ gap: 12 }}>
    <TextInput accessibilityLabel="Your name" value={name} onChangeText={setName} style={styles.input} />
    <Btn label="Next step" onPress={onNext} />
  </View>);
}
function LocalStepOne({ onNext }) { const [name, setName] = useState(""); return <StepOne name={name} setName={setName} onNext={onNext} />; }
function NavStateLost({ buggy }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  if (step === 2) return (<View style={{ gap: 12 }}><Text>Step 2 of 2</Text><Btn label="Previous step" onPress={() => setStep(1)} /></View>);
  // Bug: the name lives in the step's own state, so it is gone when the step is shown again.
  return buggy ? <LocalStepOne onNext={() => setStep(2)} /> : <StepOne name={name} setName={setName} onNext={() => setStep(2)} />;
}

function ButtonStaysDisabled({ buggy }) {
  const [agreed, setAgreed] = useState(false);
  const [done, setDone] = useState(false);
  return (<View style={{ gap: 12 }}>
    <Btn label={agreed ? "Agreed to the terms" : "Agree to the terms"} onPress={() => setAgreed(true)} />
    <Btn label="Continue" disabled={buggy ? true : !agreed} onPress={() => setDone(true)} />
    {done ? <Text>Account created</Text> : null}
  </View>);
}

function Profile({ user }) { return <Text>City: {user.address.city}</Text>; }
function RenderCrash({ buggy }) {
  const [open, setOpen] = useState(false);
  const user = buggy ? { name: "Ada" } : { name: "Ada", address: { city: "Douala" } };
  return (<View style={{ gap: 12 }}><Btn label="Open profile" onPress={() => setOpen(true)} />{open ? <Profile user={user} /> : null}</View>);
}

function WrongScreen({ buggy }) {
  const [tab, setTab] = useState("Home");
  return (<View style={{ gap: 12 }}>
    <Text accessibilityRole="header">{tab} screen</Text>
    <Btn label="Go to orders" onPress={() => setTab(buggy ? "Settings" : "Orders")} />
    <Btn label="Go to settings" onPress={() => setTab("Settings")} />
  </View>);
}

// ---- Simulated hardware ----

function CameraDenied({ buggy }) {
  const [msg, setMsg] = useState("");
  const scan = async () => {
    setMsg("Scanning…");
    const status = await device.permissions.request("camera");
    if (!buggy && status !== "granted") setMsg("Camera access is off. Type the code instead.");
  };
  return (<View style={{ gap: 12 }}><Btn label="Scan product" onPress={scan} /><Text>{msg}</Text></View>);
}

function LocationDenied({ buggy }) {
  const [msg, setMsg] = useState("");
  const find = () => {
    setMsg("Finding shops…");
    const p = device.location.current().then(() => setMsg("3 shops near you"));
    if (buggy) p.catch(() => {}); else p.catch(() => setMsg("Turn on location to see shops near you"));
  };
  return (<View style={{ gap: 12 }}><Btn label="Find shops" onPress={find} /><Text>{msg}</Text></View>);
}

function BiometricFail({ buggy }) {
  const [msg, setMsg] = useState("");
  const pay = async () => {
    const r = await device.auth.confirm("Confirm payment of 4 200 FCFA");
    setMsg(buggy || r.ok ? "Payment sent" : "Not confirmed. Nothing was paid.");
  };
  return (<View style={{ gap: 12 }}><Btn label="Pay 4 200 FCFA" onPress={pay} /><Text>{msg}</Text></View>);
}

const charge = () => device.pay.charge({ provider: "mobile_money", amount: 4200, currency: "FCFA", to: "Bug Bench", reference: "BB-1", phone: "677000111" }, "1234");

function PaymentDeclined({ buggy }) {
  const [msg, setMsg] = useState("");
  const pay = async () => { const r = await charge(); setMsg(buggy || r.ok ? "Order placed" : "Payment declined. Try another method."); };
  return (<View style={{ gap: 12 }}><Btn label="Pay now" onPress={pay} /><Text>{msg}</Text></View>);
}

function PaymentTimeout({ buggy }) {
  const [msg, setMsg] = useState("");
  const pay = async () => {
    const r = await charge();
    // Bug: only "declined" counts as a failure, so a timeout is treated as paid.
    const failed = buggy ? !r.ok && r.reason === "declined" : !r.ok;
    setMsg(failed ? "Payment did not go through" : "Order placed");
  };
  return (<View style={{ gap: 12 }}><Btn label="Pay now" onPress={pay} /><Text>{msg}</Text></View>);
}

function OfflineFetch({ buggy }) {
  const [msg, setMsg] = useState("");
  const load = () => {
    setMsg("Loading offers…");
    const p = fetch("https://offers.bug-bench.invalid/offers.json").then(() => setMsg("Offers loaded"));
    if (buggy) p.catch(() => {}); else p.catch(() => setMsg("You are offline. Try again."));
  };
  return (<View style={{ gap: 12 }}><Btn label="Load offers" onPress={load} /><Text>{msg}</Text></View>);
}

function OfflineBanner({ buggy }) {
  const [online, setOnline] = useState(device.net.online());
  useEffect(() => { if (!buggy) return device.net.onChange(setOnline); }, [buggy]);
  return (<View style={{ gap: 12 }}><Text>{online ? "Connected" : "No connection"}</Text></View>);
}

const CATALOG = { "6181234567890": "Chrome Spoon" };
function ScanWrongField({ buggy }) {
  const [msg, setMsg] = useState("");
  const scan = async () => {
    const r = await device.camera.scan({ prompt: "Scan the product barcode" });
    if (!r) return setMsg("Scan cancelled");
    setMsg(CATALOG[buggy ? r.type : r.data] ?? "Unknown product");
  };
  return (<View style={{ gap: 12 }}><Btn label="Scan product" onPress={scan} /><Text>{msg}</Text></View>);
}

// ---- Code that only runs on Android and iOS ----

function PlatformFile({ buggy }) { return <Price amount={1500} buggy={buggy} />; }

function PlatformSelect({ buggy }) {
  const format = Platform.select({ native: buggy ? String : money, default: money });
  return <Text>Price: {format(1500)}</Text>;
}

function PlatformOsBranch({ buggy }) {
  const label = buggy && Platform.OS === "ios" ? "Paiement" : "Checkout";
  return <Text>Button: {label}</Text>;
}

export const CASES = {
  "cart-total": CartTotal, "stale-state": StaleState, "delete-wrong-row": DeleteWrongRow, "double-submit": DoubleSubmit,
  "empty-form": EmptyForm, "inverted-error": InvertedError, "search-race": SearchRace, "pagination-repeat": PaginationRepeat,
  "nav-state-lost": NavStateLost, "button-stays-disabled": ButtonStaysDisabled, "render-crash": RenderCrash, "wrong-screen": WrongScreen,
  "camera-denied": CameraDenied, "location-denied": LocationDenied, "biometric-fail": BiometricFail, "payment-declined": PaymentDeclined,
  "payment-timeout": PaymentTimeout, "offline-fetch": OfflineFetch, "offline-banner": OfflineBanner, "scan-wrong-field": ScanWrongField,
  "platform-file": PlatformFile, "platform-select": PlatformSelect, "platform-os-branch": PlatformOsBranch,
};

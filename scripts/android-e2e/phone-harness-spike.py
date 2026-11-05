# Spike for #110: drive one purchase of the sample app on the Android emulator through Phone Harness
# (https://github.com/ShawnPana/phone-harness, MIT), and compare what it reads on each screen with what the
# Shipvo simulator shows for the same screen. Not part of any published package.
#
#   pip install git+https://github.com/ShawnPana/phone-harness      (in a venv; no account, no cloud)
#   phone-harness config set telemetry false                       (it sends usage events by default)
#   node apps/tide-and-tackle/sim/server.mjs &                      (simulator on :4545)
#   DO_NOT_TRACK=1 phone-harness < scripts/android-e2e/phone-harness-spike.py > spike.json
#
# phone-harness runs this file with its helpers (screen, tap, type_text, wait_for_text, ...) as globals.
import json, re, subprocess, time, urllib.request

SIM = "http://localhost:4545"
PKG = "dev.shipvo.tide"


def sim_call(path, body):
    req = urllib.request.Request(SIM + path, json.dumps(body).encode(), {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def sim_elements():
    out = []
    for line in sim_call("/act", {"session": "spike", "action": "screen"})["screen"].split("\n"):
        m = re.match(r'^\s*- (button|textbox|radio|heading|generic|link|checkbox) "([^"]+)"(.*?)(?:\[ref=(e\d+)\]|:?\s*$)', line)
        t = re.match(r"^\s*- generic \[ref=(e\d+)\]: (.+)$", line)
        if m:
            out.append({"role": m.group(1), "label": m.group(2).strip(), "ref": m.group(4)})
        elif t:
            out.append({"role": "text", "label": t.group(2).strip(), "ref": t.group(1)})
    return out


def sim_do(action, rx, text=None):
    roles = ("textbox",) if action == "type" else ("button", "radio", "link")
    el = next((e for e in sim_elements() if e["role"] in roles and re.search(rx, e["label"])), None)
    if not el:
        raise RuntimeError("sim: no element " + rx)
    body = {"session": "spike", "action": action, "ref": el["ref"]}
    if text is not None:
        body["text"] = text
    sim_call("/act", body)


# One purchase: browse, 2 x Chrome Spoon, Friday delivery, cash. Same flow as "A" in docs/parity-results.md.
# (act, regex of the element, text to type, regex that must be visible afterwards, screen name)
STEPS = [
    (None, None, None, r"^Shop by department$", "Home"),
    ("tap", r"^Chrome Spoon 30 g", None, r"^Increase quantity$", "Product"),
    ("tap", r"^Increase quantity$", None, r"^Add 2 to cart$", None),
    ("tap", r"^Add 2 to cart$", None, r"^Open cart", "Added"),
    ("tap", r"^Open cart", None, r"^Choose delivery and pay$", "Cart"),
    ("tap", r"^Choose delivery and pay$", None, r"^Friday 14:00", "Checkout"),
    ("tap", r"^Friday 14:00", None, r"^Delivery address", None),
    ("type", r"^Delivery address", "Bonapriso Douala", r"Bonapriso Douala", None),
    ("tap", r"^Place order$", None, r"^Share order$", "Order placed"),
]


def device_labels():
    return [b["text"].strip() for b in screen() if b["text"].strip()]


def find(rx):
    # The accessibility tree also lists nodes that are scrolled off screen, with x=y=0. Skip those for taps.
    return next((b for b in screen() if re.search(rx, b["text"]) and b["x"] > 0 and b["y"] > 0), None)


def dev_find_scrolling(rx, tries=8):
    for _ in range(tries):
        b = find(rx)
        if b:
            return b
        scroll("down", 0.5)
        time.sleep(0.8)
    raise RuntimeError("device: no element " + rx)


def dev_wait(rx, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if find(rx):
            return round((time.time() - t0) * 1000)
        time.sleep(0.25)
    raise RuntimeError("device: never saw " + rx)


# Fresh app on both sides.
subprocess.run(["adb", "shell", "am", "force-stop", PKG], check=True)
subprocess.run(["adb", "shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"], capture_output=True)
sim_call("/session", {"session": "spike", "device": {"platform": "android", "api": 30, "biometrics": {"enrolled": False}}})
t0 = time.time()
dev_wait(STEPS[0][3], 30)
launch_ms = round((time.time() - t0) * 1000)

rows = []
for act, rx, text, expect, name in STEPS:
    row = {"step": (act or "launch") + (" " + rx if rx else ""), "screen": name}
    if act:
        t = time.time()
        b = dev_find_scrolling(rx)
        row["deviceFindMs"] = round((time.time() - t) * 1000)
        t = time.time()
        tap(b["x"], b["y"])
        if act == "type":
            time.sleep(0.5)
            type_text(text)
            back()  # close the keyboard so the next element is reachable
        row["deviceActMs"] = round((time.time() - t) * 1000)
        row["deviceToNextScreenMs"] = dev_wait(expect)
        t = time.time()
        sim_do(act, rx, text)
        row["simStepMs"] = round((time.time() - t) * 1000)
    if name:
        t = time.time()
        d = device_labels()
        row["deviceReadMs"] = round((time.time() - t) * 1000)
        t = time.time()
        s = [e["label"] for e in sim_elements()]
        row["simReadMs"] = round((time.time() - t) * 1000)
        sset, dset = set(s), set(d)
        row["deviceLabels"] = len(dset)
        row["simLabels"] = len(sset)
        row["deviceVisibleAlsoInSim"] = len(dset & sset)
        row["deviceVisibleNotInSim"] = sorted(dset - sset)
        # The simulator lists the whole page; the phone only what is on screen. So the other direction is not scored.
        row["simNotVisibleOnDevice"] = len(sset - dset)
    rows.append(row)

done = bool(find(r"^Share order$"))
print(json.dumps({"launchToHomeMs": launch_ms, "orderPlacedOnDevice": done,
                  "orderPlacedOnSim": any(re.search(r"^Share order$", e["label"]) for e in sim_elements()),
                  "steps": rows}, indent=1))

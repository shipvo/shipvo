#!/usr/bin/env python3
"""Insert the Shipvo entry into punkpeye/awesome-mcp-servers README.md (Developer Tools, alphabetical).
usage: add-to-awesome-mcp-servers.py README.md"""
import re, sys
ENTRY = ("- [shipvo/shipvo](https://github.com/shipvo/shipvo) 📇 ☁️ 🏠 - Open a React Native app in a simulated phone: "
         "read the accessibility tree, tap, type, and set device state such as permissions, connectivity and payment results.")
KEY = "shipvo/shipvo"
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().split("\n")
if any("github.com/shipvo/shipvo" in l for l in lines):
    print("already listed"); sys.exit(3)
start = next(i for i, l in enumerate(lines) if l.startswith("### ") and 'name="developer-tools"' in l)
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("### "))
def key(l):
    m = re.match(r"- \[@?([^\]]+)\]", l)
    return m.group(1).lower() if m else None
items = [i for i in range(start + 1, end) if key(lines[i])]
at = None
# the list is only loosely sorted: use the first spot where two consecutive "s" entries bracket our name
for a, b in zip(items, items[1:]):
    if b == a + 1 and key(lines[a])[0] == "s" == key(lines[b])[0] and key(lines[a]) <= KEY < key(lines[b]):
        at = b; break
if at is None:
    print("no sorted spot found; refusing to guess"); sys.exit(4)
lines.insert(at, ENTRY)
open(p, "w", encoding="utf-8").write("\n".join(lines))
print("inserted at line", at + 1, "between:", key(lines[at-1]), "|", key(lines[at+1]))

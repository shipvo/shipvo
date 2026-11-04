import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyze } from "./analyze.mjs";

function makeLog(entries) {
  const dir = mkdtempSync(join(tmpdir(), "analyze-"));
  const file = join(dir, "log.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

function makeMarks(runs) {
  const dir = mkdtempSync(join(tmpdir(), "analyze-"));
  const file = join(dir, "marks.json");
  writeFileSync(file, JSON.stringify({ pointer_published: 1000, app_launched: 2000, healthy: 3000, runs }));
  return file;
}

describe("analyze", () => {
  it("returns deterministic output for even run count", () => {
    const logFile = makeLog([
      { time: 1000, path: "/pointer.json", method: "GET", status: 200, bytes: 100 },
      { time: 1001, path: "/bundle.apk", method: "GET", status: 200, bytes: 200 },
      { time: 2000, path: "/apply", method: "POST", status: 200 },
      { time: 3000, path: "/healthy", method: "POST", status: 200 },
      { time: 1002, path: "/pointer.json", method: "GET", status: 200, bytes: 150 },
      { time: 1003, path: "/bundle.apk", method: "GET", status: 200, bytes: 250 },
      { time: 2001, path: "/apply", method: "POST", status: 200 },
      { time: 3001, path: "/healthy", method: "POST", status: 200 },
    ]);
    const marksFile = makeMarks(2);
    const output = analyze(logFile, marksFile);
    expect(output).toEqual([
      ["Metric", "Median"],
      ["Download bytes", "175"],
      ["Download time (ms)", "1"],
      ["Apply time (ms)", "1"],
      ["Publish to healthy (ms)", "1"],
    ]);
  });

  it("returns deterministic output for odd run count", () => {
    const logFile = makeLog([
      { time: 1000, path: "/pointer.json", method: "GET", status: 200, bytes: 100 },
      { time: 1001, path: "/bundle.apk", method: "GET", status: 200, bytes: 200 },
      { time: 2000, path: "/apply", method: "POST", status: 200 },
      { time: 3000, path: "/healthy", method: "POST", status: 200 },
      { time: 1002, path: "/pointer.json", method: "GET", status: 200, bytes: 150 },
      { time: 1003, path: "/bundle.apk", method: "GET", status: 200, bytes: 250 },
      { time: 2001, path: "/apply", method: "POST", status: 200 },
    ]);
    const marksFile = makeMarks(2);
    const output = analyze(logFile, marksFile);
    expect(output).toEqual([
      ["Metric", "Median"],
      ["Download bytes", "175"],
      ["Download time (ms)", "1"],
      ["Apply time (ms)", "1"],
      ["Publish to healthy (ms)", "1"],
    ]);
  });
});

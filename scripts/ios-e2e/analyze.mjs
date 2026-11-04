#!/usr/bin/env node
// Analyzer for iOS e2e server logs and marks.
// Usage: node analyze.mjs <logFile> <marksFile>
import { readFileSync } from "node:fs";

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseLog(logFile) {
  const lines = readFileSync(logFile, "utf-8").trim().split("\n");
  const entries = lines.map((line) => JSON.parse(line));
  return entries;
}

function parseMarks(marksFile) {
  return JSON.parse(readFileSync(marksFile, "utf-8"));
}

function analyze(logFile, marksFile) {
  const entries = parseLog(logFile);
  const marks = parseMarks(marksFile);

  const runs = marks.runs;
  const downloadEntries = entries.filter((e) => e.method === "GET" && e.status === 200 && e.path.includes("bundle"));
  const applyEntries = entries.filter((e) => e.method === "POST" && e.path.includes("apply"));
  const healthyEntries = entries.filter((e) => e.method === "POST" && e.path.includes("healthy"));

  const downloadBytes = downloadEntries.map((e) => e.bytes);
  const downloadTimes = downloadEntries.map((e) => e.time - marks.pointer_published);
  const applyTimes = applyEntries.map((e) => e.time - marks.app_launched);
  const publishToHealthy = healthyEntries.map((e) => e.time - marks.pointer_published);

  const table = [
    ["Metric", "Median"],
    ["Download bytes", `${median(downloadBytes)}`],
    ["Download time (ms)", `${median(downloadTimes)}`],
    ["Apply time (ms)", `${median(applyTimes)}`],
    ["Publish to healthy (ms)", `${median(publishToHealthy)}`],
  ];

  return table;
}

function printTable(table) {
  const colWidths = table[0].map((_, i) => Math.max(...table.map((row) => String(row[i]).length)));
  const separator = table[0].map((_, i) => "-".repeat(colWidths[i] + 2)).join("|");
  const header = table[0].map((cell, i) => ` ${cell.padEnd(colWidths[i])} `).join("|");
  const rows = table.slice(1).map((row) => row.map((cell, i) => ` ${cell.padEnd(colWidths[i])} `).join("|"));
  console.log(header);
  console.log(separator);
  rows.forEach((row) => console.log(row));
}

const logFile = process.argv[2];
const marksFile = process.argv[3];
const table = analyze(logFile, marksFile);
printTable(table);

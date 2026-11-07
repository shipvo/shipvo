// shipvo.dev/demos/chess: two phones, one game. Android plays white, iOS plays black.
// The phones load when the section is on screen. The game plays itself (a 13-move game that ends in checkmate)
// until the visitor presses "Play against it": then white is theirs and the code picks the replies for black.
import { newClock, readClock, syncClock, formatClock } from "./clock.js";
import { startPosition, parseUci, findLegalMove, applyMove, legalMoves, moveToUci } from "./engine.js";

const GAME = ["e2e4", "e7e5", "g1f3", "d7d6", "f1c4", "c8g4", "b1c3", "g7g6", "f3e5", "g4d1", "c4f7", "e8e7", "c3d5"];
const q = new URLSearchParams(location.search);
const delay = Math.max(0, Number(q.get("delay") || 1400));
const $ = (id) => document.getElementById(id);
const frames = { white: $("cd-phone-white"), black: $("cd-phone-black") };
const appWin = (side) => { try { return frames[side].contentWindow.frames[0]; } catch { return null; } };
const post = (side, msg) => { const w = appWin(side); if (w) w.postMessage(msg, "*"); };

let mode = "watch", gen = 0, ready = { white: false, black: false }, moves = [], over = false, clock = newClock(Date.now()), started = false, timer = 0, visible = false;
const say = (t) => { $("cd-status").textContent = t; };

function paint() {
  const t = readClock(clock, Date.now());
  for (const s of ["white", "black"]) { const el = $("cd-clock-" + s); el.textContent = formatClock(t[s]); el.classList.toggle("running", clock.running === s); }
}
setInterval(paint, 250);

function describe() {
  if (over) return say("Game over after " + moves.length + " moves");
  const white = moves.length % 2 === 0;
  say(mode === "play" ? (white ? "Your move. Tap a white piece, then a square." : "Black is thinking") : (white ? "White" : "Black") + " to move, move " + (Math.floor(moves.length / 2) + 1));
}
function renderMoves() {
  const ol = $("cd-moves"); ol.textContent = "";
  for (let i = 0; i < moves.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = (i / 2 + 1) + ". " + moves[i] + (moves[i + 1] ? " " + moves[i + 1] : "");
    ol.appendChild(li);
  }
}

function schedule(fn) { clearTimeout(timer); const g = gen; timer = setTimeout(() => { if (g === gen && !document.hidden) fn(); else if (g === gen) schedule(fn); }, delay); }
function autoplay() {
  if (over || moves.length >= GAME.length) return;
  const u = GAME[moves.length], side = moves.length % 2 ? "black" : "white";
  post(side, { type: "chess:play", from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
  schedule(autoplay);
}
function reply() {
  if (over || moves.length % 2 === 0) return;
  let pos = startPosition();
  for (const u of moves) { const m = findLegalMove(pos, parseUci(u)); if (!m) return; pos = applyMove(pos, m); }
  const all = legalMoves(pos);
  if (!all.length) return;
  const u = moveToUci(all[Math.floor(Math.random() * all.length)]);
  post("black", { type: "chess:play", from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
}

addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "chess:moves" || !Array.isArray(d.moves)) return;
  const from = appWin("white") === e.source ? "white" : appWin("black") === e.source ? "black" : null;
  if (!from) return;
  ready[from] = true;
  if (d.moves.length > moves.length) {
    moves = d.moves; over = !!d.over;
    clock = syncClock(clock, moves.length, over, Date.now());
    paint(); renderMoves();
    post(from === "white" ? "black" : "white", { type: "chess:moves", moves });
    describe();
    if (mode === "play" && !over && moves.length % 2 === 1) { const g = gen; setTimeout(() => { if (g === gen) reply(); }, 700); }
  }
  if (ready.white && ready.black && !started) {
    started = true; clock = newClock(Date.now()); describe();
    if (mode === "watch") schedule(autoplay);
  }
});

function load() {
  gen++; clearTimeout(timer);
  ready = { white: false, black: false }; moves = []; over = false; started = false; clock = newClock(Date.now());
  renderMoves(); paint(); say("Loading the phones");
  for (const f of Object.values(frames)) f.src = f.dataset.src;
  $("cd-mode").textContent = mode === "play" ? "Watch it play itself" : "Play against it";
}
$("cd-mode").addEventListener("click", () => { mode = mode === "play" ? "watch" : "play"; load(); });

// Load the phones when the section is on screen.
const box = $("chess-demo");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); visible = true; load(); } }, { rootMargin: "200px" });
  io.observe(box);
} else { visible = true; load(); }

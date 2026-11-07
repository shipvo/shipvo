// The page with two phones side by side. Android plays white, iOS plays black. The page keeps the
// two games the same, runs one move timer per side and can play a full game by itself (?autoplay=1).
import { readFileSync } from "node:fs";

// Légal's mate: a full game of 13 moves that ends in checkmate.
export const DEMO_GAME = ["e2e4", "e7e5", "g1f3", "d7d6", "f1c4", "c8g4", "b1c3", "g7g6", "f3e5", "g4d1", "c4f7", "e8e7", "c3d5"];

const clockSource = () => readFileSync(new URL("./clock.mjs", import.meta.url), "utf8").replace(/^export /gm, "");

// agents: null for the plain demo, or { moveTime, white, black } (names of the two assistants, move time in ms; 0 = no limit).
export function demoPage({ android, ios, agents = null }) {
  const names = agents ? { white: agents.white, black: agents.black } : null;
  const label = (side, os) => `${os} plays ${side}` + (names ? " &middot; " + String(names[side]).replace(/[&<>"]/g, "") : "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chess on Android and iOS (simulated)</title>
<style>
html,body{margin:0;height:100%;background:#e8eaed;font:14px system-ui,sans-serif;color:#111}
body{display:flex;flex-direction:column}
h1{font-size:16px;margin:10px 16px 0}
#status{margin:2px 16px;font-size:13px}
.row{flex:1;display:flex;gap:12px;padding:8px 12px;min-height:0}
.side{flex:1;display:flex;flex-direction:column;min-width:0}
.side h2{font-size:14px;margin:0 0 4px;display:flex;justify-content:space-between;align-items:baseline}
#result{margin:2px 16px;font:600 18px system-ui,sans-serif}
#moves{margin:0 16px 8px;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:4px 10px;font:13px ui-monospace,monospace}
#start{margin:0 16px 8px;padding:8px 14px;font:600 14px system-ui,sans-serif;align-self:flex-start}
.clock{font:600 22px ui-monospace,monospace;padding:2px 10px;border-radius:8px;background:#fff}
.clock.running{background:#111;color:#fff}
iframe{flex:1;border:0;width:100%;min-height:0;background:#e8eaed}
@media (max-width:700px){.row{flex-direction:column;overflow:auto}.side{min-height:480px;flex:none}}
@media (prefers-color-scheme:dark){
html,body{background:#14161a;color:#e8eaed}
.clock{background:#2a2e35;color:#e8eaed}
.clock.running{background:#e8eaed;color:#111}
iframe{background:#14161a}}
</style></head><body>
<h1>Chess on Android and iOS (simulated)</h1>
<div id="status" role="status" data-part="game-status">Waiting for both phones</div>
<div id="result" role="status" data-part="result" hidden></div>
<div class="row">
<section class="side" data-side="white"><h2><span data-part="name-white">${label("white", "Android")}</span><span class="clock" id="clock-white" data-part="clock-white" role="timer" aria-label="White clock">0:00</span></h2><iframe id="phone-white" title="Android phone, white" src="${android}"></iframe></section>
<section class="side" data-side="black"><h2><span data-part="name-black">${label("black", "iOS")}</span><span class="clock" id="clock-black" data-part="clock-black" role="timer" aria-label="Black clock">0:00</span></h2><iframe id="phone-black" title="iOS phone, black" src="${ios}"></iframe></section>
</div>
<ol id="moves" data-part="moves" aria-label="Moves"></ol>
<button id="start" data-part="start" hidden>Start the clock</button>
<script>
${clockSource()}
var CONFIG=${JSON.stringify(agents ? { agents: true, moveTime: agents.moveTime } : { agents: false, moveTime: 0 })};
var GAME=${JSON.stringify(DEMO_GAME)};
var q=new URLSearchParams(location.search),delay=Math.max(0,Number(q.get("delay")||700));
var frames={white:document.getElementById("phone-white"),black:document.getElementById("phone-black")};
function appWin(side){try{return frames[side].contentWindow.frames[0]}catch(e){return null}}
var ready={white:false,black:false},moves=[],san=[],over=false,result=null,clock=newClock(Date.now()),started=false,live=false;
function say(t){document.getElementById("status").textContent=t}
function paint(){var t=readClock(clock,Date.now());
 ["white","black"].forEach(function(s){var el=document.getElementById("clock-"+s);el.textContent=formatClock(t[s]);el.classList.toggle("running",clock.running===s)})}
function post(side,msg){var w=appWin(side);if(w)w.postMessage(msg,"*")}
function describe(){say(over?"Game over after "+moves.length+" moves":!live?"Waiting for both players":(moves.length%2?"Black":"White")+" to move, move "+(Math.floor(moves.length/2)+1))}
function showMoves(){var ol=document.getElementById("moves");ol.textContent="";
 san.forEach(function(m,i){var li=document.createElement("li");li.textContent=(i%2?"":(i/2+1)+". ")+m;ol.appendChild(li)})}
function report(){try{fetch("/__game",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({san:san,moves:moves,over:over,result:result,started:live}),keepalive:true})}catch(e){}}
function go(){if(live)return;live=true;clock=newClock(Date.now());describe();paint();report()}
document.getElementById("start").onclick=function(){go();this.hidden=true};
setInterval(function(){paint();
 // A side that takes longer than the move time loses the game.
 if(CONFIG.moveTime>0&&live&&!over&&clock.running&&Date.now()-clock.since>CONFIG.moveTime){
  var loser=clock.running;over=true;result="Time out, "+(loser==="white"?"black":"white")+" wins";
  clock=syncClock(clock,moves.length,true,Date.now());post("white",{type:"chess:timeout",loser:loser});post("black",{type:"chess:timeout",loser:loser});finish()}},200);paint();
function finish(){var r=document.getElementById("result");r.hidden=false;r.textContent=result||"Game over";describe();report()}
addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="chess:moves"||!Array.isArray(d.moves))return;
 var from=appWin("white")===e.source?"white":appWin("black")===e.source?"black":null;if(!from)return;
 var first=!ready[from];ready[from]=true;
 if(first&&CONFIG.agents)post(from,{type:"chess:seat",seat:from});
 if(d.moves.length>moves.length){if(CONFIG.agents&&!live)go();moves=d.moves;if(Array.isArray(d.san))san=d.san;showMoves();post(from==="white"?"black":"white",{type:"chess:moves",moves:moves});
  clock=syncClock(clock,moves.length,over||!!d.over,Date.now());paint();describe();report()}
 if(d.over&&!over){over=true;result=d.result||null;clock=syncClock(clock,moves.length,true,Date.now());finish()}
 if(ready.white&&ready.black&&!started){started=true;
  if(CONFIG.agents){say("Waiting for both players");document.getElementById("start").hidden=false;clock.running=null}
  else{live=true;clock=newClock(Date.now());describe();if(q.get("autoplay")==="1")setTimeout(play,delay)}}});
function play(){if(over||moves.length>=GAME.length)return;var u=GAME[moves.length],side=moves.length%2?"black":"white";
 post(side,{type:"chess:play",from:u.slice(0,2),to:u.slice(2,4),promotion:u.slice(4)||undefined});setTimeout(play,delay)}
</script></body></html>`;
}

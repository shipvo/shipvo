// The recorder that runs inside the preview frame page. It is plain browser JavaScript kept as a string,
// so `shipvo preview` can inline it. `shipvoExport` mirrors `exportTest` in packages/mcp/src/export.ts;
// a test keeps the two outputs identical.
export const RECORDER_JS = String.raw`
var shipvoSteps=[];
function shipvoQ(s){return JSON.stringify(s).replace(new RegExp("\\u2028","g"),"\\\\u2028").replace(new RegExp("\\u2029","g"),"\\\\u2029")}
function shipvoOneLine(s){return s.replace(new RegExp("[\\r\\n\\u2028\\u2029]+","g")," ")}
function shipvoEnv(l){return "SHIPVO_TEST_"+(l.replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"").toUpperCase()||"FIELD")}
function shipvoLine(s){
  var t=s.target;
  if(s.action==="note")return ["// "+shipvoOneLine(s.text||"")];
  if(s.action==="back")return ["await phone.back();"];
  if(s.action==="scroll")return ["await phone.scroll("+shipvoQ(["down","up","left","right"].indexOf(s.direction)>=0?s.direction:"down")+");"];
  if(s.action==="tap"){
    if(!t)return ["// TODO: tap without a target"];
    if(t.matches>1)return ["// TODO: ambiguous target "+shipvoOneLine(shipvoQ(t.text))];
    return ["await phone.tap("+shipvoQ(t.text)+");"];
  }
  if(s.action==="type"){
    var label=s.fieldLabel||(t&&t.text);
    if(!label)return ["// TODO: type without a field label"];
    if(t&&t.matches>1)return ["// TODO: ambiguous target "+shipvoOneLine(shipvoQ(label))];
    return ["await phone.type("+shipvoQ(label)+", "+(s.passwordLike?"process.env."+shipvoEnv(label)+"!":shipvoQ(s.text||""))+");"];
  }
  return [];
}
function shipvoExport(app,steps,title){
  var out=['import { test } from "@shipvo/test/vitest";','import { openApp } from "@shipvo/test";','','test('+shipvoQ("recorded session for "+(title||app))+', async () => {','  const phone = await openApp({ app: '+shipvoQ(app)+' });'];
  steps.forEach(function(s){
    var lines=shipvoLine(s);
    lines.forEach(function(l){out.push("  "+l)});
    if(s.changed&&lines.length&&lines[0].indexOf("//")!==0&&s.action!=="open")out.push("  await phone.waitFor(/\\S/); // TODO: name the text that should appear");
  });
  out.push("});","");
  return out.join("\n");
}
function shipvoLabel(el){
  var l=el.getAttribute("aria-label")||(el.labels&&el.labels[0]&&el.labels[0].textContent)||el.getAttribute("placeholder")||el.textContent||"";
  return l.replace(/\s+/g," ").trim();
}
function shipvoCount(doc,label){
  var n=0;doc.querySelectorAll("button,a,[role=button],[role=link],[role=tab],input,textarea,[aria-label]").forEach(function(e){if(shipvoLabel(e)===label)n++});
  return n;
}
function shipvoAttach(frame,onStep){
  var doc=frame.contentDocument;if(!doc)return;
  var sel="button,a,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox]";
  doc.addEventListener("click",function(e){
    var el=e.target&&e.target.closest&&e.target.closest(sel);
    if(!el||el.matches("input,textarea"))return;
    var text=shipvoLabel(el);if(!text){onStep({action:"note",text:"TODO: tap without a label"});return}
    onStep({action:"tap",target:{text:text,role:el.getAttribute("role")||el.tagName.toLowerCase(),matches:shipvoCount(doc,text)},changed:true});
  },true);
  doc.addEventListener("change",function(e){
    var el=e.target;if(!el||!/^(INPUT|TEXTAREA)$/.test(el.tagName))return;
    var label=shipvoLabel(el);if(!label)return;
    onStep({action:"type",fieldLabel:label,text:el.value,passwordLike:el.type==="password",target:{text:label,role:"textbox",matches:shipvoCount(doc,label)}});
  },true);
}
`;

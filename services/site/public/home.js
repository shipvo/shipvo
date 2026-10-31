(function(){
  // the replaying agent run in the hero
  var lines=[
    '- heading "Checkout" [level=1] [ref=e6]',
    '- button "Scan a product barcode" [ref=e8]',
    '<span class="dlg">Allow Tide &amp; Tackle to take pictures and record video?<br>- button "While using the app" [ref=e12]</span>',
    '- heading "Surface Popper 9 cm" [ref=e14]',
    '- generic [ref=e15]: 4 200 FCFA',
    '- button "Add 1 to cart" [ref=e16]',
    '- button "Use my location" [ref=e21]',
    '- generic [ref=e23]: You\'re 0.7 km from the shop',
    '- radio "Mobile money" [ref=e31]',
    '- textbox "Mobile money number" [ref=e33]',
    '<span class="hi">- button "Place order" [ref=e42]</span>',
    '<span class="dlg">Confirm with fingerprint<br>- button "Use fingerprint" [ref=e57]</span>',
    '- textbox "Mobile money PIN" [ref=e61]',
    '- button "Confirm payment" [ref=e63]',
    '- heading "Order TT-1001 placed" [ref=e70]'
  ];
  var tree=document.getElementById('tree'),res=document.getElementById('result');
  if(tree){
    function run(){tree.innerHTML='';res.classList.remove('on');var i=0;(function step(){if(i>=lines.length){res.classList.add('on');setTimeout(run,6000);return}var el=document.createElement('span');el.className='l';el.innerHTML=lines[i++];tree.appendChild(el);requestAnimationFrame(function(){el.classList.add('on')});while(tree.scrollHeight>tree.clientHeight&&tree.children.length>1)tree.removeChild(tree.firstChild);setTimeout(step,i===11||i===12?1100:520)})()}
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){tree.innerHTML=lines.slice(-9).map(function(l){return '<span class="l on">'+l+'</span>'}).join('');res.classList.add('on')}else run();
  }
  // tabs
  document.querySelectorAll('[data-tabs]').forEach(function(t){var tabs=[].slice.call(t.querySelectorAll('[role=tab]')),panels=tabs.map(function(b){return document.getElementById(b.getAttribute('aria-controls'))});
    function pick(i){tabs.forEach(function(b,j){b.setAttribute('aria-selected',i===j);panels[j].hidden=i!==j})}
    tabs.forEach(function(b,i){b.addEventListener('click',function(){pick(i)});b.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){var n=(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;pick(n);tabs[n].focus()}})});
  });
  // live chips
  function set(sel,v,ok){var e=document.querySelector(sel);if(!e)return;e.textContent=v;if(ok!==undefined)e.closest('.chip').classList.add(ok?'ok':'down')}
  fetch('https://api.shipvo.dev/w/tide/releases.json').then(function(r){return r.json()}).then(function(d){set('[data-live-release]','r'+d.latest)}).catch(function(){set('[data-live-release]','—')});
  fetch('https://api.shipvo.dev/health',{cache:'no-store'}).then(function(r){set('[data-live-api]',r.ok?'live':'down',r.ok)}).catch(function(){set('[data-live-api]','down',false)});
  fetch('https://sim.shipvo.dev/health',{cache:'no-store'}).then(function(r){set('[data-live-sim]',r.ok?'live':'down',r.ok)}).catch(function(){set('[data-live-sim]','down',false)});
  // marketplace preview
  var grid=document.getElementById('market-grid');
  var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  fetch('/api/apps').then(function(r){return r.json()}).then(function(d){var apps=d.apps||[];set('[data-live-apps]',String(apps.length));if(!grid)return;
    var rows=apps.slice(0,3);
    grid.innerHTML=rows.map(function(a){return '<a class="card" href="/apps/'+esc(a.app_id)+'"><div class="top">'+(a.icon_url?'<img class="ico" src="'+esc(a.icon_url)+'" alt="" style="object-fit:cover">':'<div class="ico" aria-hidden="true">'+esc(a.name.trim().slice(0,1).toUpperCase())+'</div>')+'<div><h3>'+esc(a.name)+'</h3><div class="by">'+esc(a.app_id)+' · by '+esc(a.owner)+'</div></div></div><p>'+esc(a.tagline||a.description||'')+'</p><div class="meta"><span>release <b>r'+esc(a.latest_release)+'</b></span><span><b>'+esc(a.category)+'</b></span></div></a>'}).join('')+
      '<a class="card ghost" href="/docs/agents/#listing-your-app-for-every-agent"><div class="top"><div class="ico plus" aria-hidden="true">+</div><div><h3>Your app here</h3><div class="by">shipvo app create</div></div></div><p>Set <code>listing.public</code> in shipvo.json and run <code>shipvo app create</code>. After review, every signed-in agent can open it.</p><div class="meta"><span><b>Free</b> during the beta</span></div></a>';
  }).catch(function(){set('[data-live-apps]','—')});
})();

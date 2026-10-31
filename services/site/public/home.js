(function(){
  // the replaying agent run in the hero: one screen at a time, what the agent reads, and where it taps
  var steps=[
    {img:0,tap:[69,48],lines:['- heading "High tide 06:42. Bass are feeding." [ref=e6]','- button "Lures" [ref=e9]','<span class="hi">- button "Lures" \u2192 tap</span>']},
    {img:1,tap:[50,71],lines:['- heading "Chrome Spoon 30 g" [ref=e14]','- generic [ref=e15]: 2 800 FCFA','<span class="hi">- button "Add 1 to cart" [ref=e16]</span>']},
    {img:2,tap:[50,83],lines:['<span class="dlg">Allow Tide &amp; Tackle to take pictures?</span>','- button "Only this time" [ref=e12]','<span class="hi">- button "While using the app" [ref=e11]</span>']},
    {img:3,tap:[58,90],lines:['- heading "Delivery and payment" [ref=e30]','- radio "Mobile money" [ref=e31]','<span class="hi">- button "Place order" [ref=e42]</span>']}
  ];
  var tree=document.getElementById('tree'),res=document.getElementById('result'),tap=document.getElementById('tap'),imgs=[].slice.call(document.querySelectorAll('.screen img'));
  function show(i){imgs.forEach(function(m,k){m.classList.toggle('on',k===steps[i].img)})}
  if(tree){
    var timer;
    function run(){var n=0;res.classList.remove('on');tap.classList.remove('on');
      (function screen(){if(n>=steps.length){res.classList.add('on');tap.classList.remove('on');timer=setTimeout(run,4500);return}
        var st=steps[n++];show(n-1);tree.innerHTML='';tap.classList.remove('on');tap.style.left=st.tap[0]+'%';tap.style.top=st.tap[1]+'%';
        var k=0;(function line(){if(k>=st.lines.length){tap.classList.add('on');timer=setTimeout(screen,1500);return}
          var el=document.createElement('span');el.className='l';el.innerHTML=st.lines[k++];tree.appendChild(el);requestAnimationFrame(function(){el.classList.add('on')});timer=setTimeout(line,450)})()})()}
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){show(3);var st=steps[3];tree.innerHTML=st.lines.map(function(l){return '<span class="l on">'+l+'</span>'}).join('');res.classList.add('on')}else run();
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
  fetch('https://registry.npmjs.org/@shipvo/cli/latest').then(function(r){return r.json()}).then(function(d){set('[data-live-npm]','v'+d.version)}).catch(function(){set('[data-live-npm]','—')});
  // scroll reveal
  if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.08});
    document.querySelectorAll('main section:not(.hero) .sec-head,main .tabs,.pillar,.cell,.stat,.honest>div,.views figure,.beta,.card').forEach(function(el,i){el.classList.add('rv');el.style.transitionDelay=(i%4)*70+'ms';io.observe(el)});
  }
  // marketplace preview
  var grid=document.getElementById('market-grid');
  var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  fetch('/api/apps').then(function(r){return r.json()}).then(function(d){var apps=d.apps||[];set('[data-live-apps]',String(apps.length));if(!grid)return;
    var rows=apps.slice(0,3);
    grid.innerHTML=rows.map(function(a){return '<a class="card" href="/apps/'+esc(a.app_id)+'"><div class="top">'+(a.icon_url?'<img class="ico" src="'+esc(a.icon_url)+'" alt="" style="object-fit:cover">':'<div class="ico" aria-hidden="true">'+esc(a.name.trim().slice(0,1).toUpperCase())+'</div>')+'<div><h3>'+esc(a.name)+'</h3><div class="by">'+esc(a.app_id)+' · by '+esc(a.owner)+'</div></div></div><p>'+esc(a.tagline||a.description||'')+'</p><div class="meta"><span>release <b>r'+esc(a.latest_release)+'</b></span><span><b>'+esc(a.category)+'</b></span></div></a>'}).join('')+
      '<a class="card ghost" href="/docs/agents/#listing-your-app-for-every-agent"><div class="top"><div class="ico plus" aria-hidden="true">+</div><div><h3>Your app here</h3><div class="by">shipvo app create</div></div></div><p>Set <code>listing.public</code> in shipvo.json and run <code>shipvo app create</code>. After review, every signed-in agent can open it.</p><div class="meta"><span><b>Free</b> during the beta</span></div></a>';
  }).catch(function(){set('[data-live-apps]','—')});
})();

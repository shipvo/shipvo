(function(){
  // dropdown menus: hover on desktop, click/keyboard everywhere
  document.querySelectorAll('.has-menu').forEach(function(w){var b=w.querySelector('button');
    function open(o){w.classList.toggle('open',o);b.setAttribute('aria-expanded',o)}
    b.addEventListener('click',function(){open(!w.classList.contains('open'))});
    w.addEventListener('mouseenter',function(){if(matchMedia('(hover:hover)').matches)open(true)});
    w.addEventListener('mouseleave',function(){if(matchMedia('(hover:hover)').matches)open(false)});
    w.addEventListener('keydown',function(e){if(e.key==='Escape'){open(false);b.focus()}});
  });
  document.addEventListener('click',function(e){document.querySelectorAll('.has-menu.open').forEach(function(w){if(!w.contains(e.target)){w.classList.remove('open');w.querySelector('button').setAttribute('aria-expanded','false')}})});
  var burger=document.querySelector('.burger'),mm=document.querySelector('.mobile-menu');
  if(burger&&mm)burger.addEventListener('click',function(){var o=mm.hidden;mm.hidden=!o;burger.setAttribute('aria-expanded',o);burger.classList.toggle('x',o)});
  // GitHub stars (live, cached an hour per browser)
  var el=document.querySelector('[data-stars]');
  if(el){try{var c=JSON.parse(localStorage.getItem('shipvo.stars')||'null');if(c&&Date.now()-c.t<36e5){el.textContent=c.v;el=null}}catch(e){}
    if(el)fetch('https://api.github.com/repos/shipvo/shipvo').then(function(r){return r.json()}).then(function(d){if(typeof d.stargazers_count==='number'){var v=d.stargazers_count>=1000?(d.stargazers_count/1000).toFixed(1)+'k':String(d.stargazers_count);el.textContent=v;try{localStorage.setItem('shipvo.stars',JSON.stringify({v:v,t:Date.now()}))}catch(e){}}}).catch(function(){})}
  // live service status in the footer
  var st=document.querySelector('[data-status]');
  if(st){Promise.all([fetch('https://api.shipvo.dev/health',{cache:'no-store'}).then(function(r){return r.ok}).catch(function(){return false}),fetch('https://sim.shipvo.dev/health',{cache:'no-store'}).then(function(r){return r.ok}).catch(function(){return false})]).then(function(a){var ok=a[0]&&a[1];st.classList.add(ok?'ok':a[0]||a[1]?'warn':'down');st.querySelector('span:last-child').textContent=ok?'all systems live':a[0]||a[1]?'partial outage':'services unreachable'})}
  // copy buttons
  document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){var t=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=t},1400)})})});
})();

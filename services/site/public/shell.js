(function(){
  // theme: automatic (follows the system) -> light -> dark; the choice is remembered in this browser
  var KEY='shipvo.theme',root=document.documentElement,NAMES={auto:'automatic',light:'light',dark:'dark'};
  function mode(){var t=root.getAttribute('data-theme');return t==='light'||t==='dark'?t:'auto'}
  function paint(){var m=mode();
    document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.setAttribute('data-mode',m);b.title='Theme: '+NAMES[m];b.setAttribute('aria-label','Colour theme: '+NAMES[m]+'. Click to change.')});
    var meta=document.querySelector('meta[name=theme-color]');
    if(meta){var light=m==='light'||(m==='auto'&&matchMedia('(prefers-color-scheme: light)').matches);meta.setAttribute('content',light?'#FAF8F3':'#090D16')}}
  document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.addEventListener('click',function(){
    var next={auto:'light',light:'dark',dark:'auto'}[mode()];
    if(next==='auto')root.removeAttribute('data-theme');else root.setAttribute('data-theme',next);
    try{if(next==='auto')localStorage.removeItem(KEY);else localStorage.setItem(KEY,next)}catch(e){}
    paint()})});
  paint();
  // dropdown menus: hover on desktop, click/keyboard everywhere
  document.querySelectorAll('.has-menu').forEach(function(w){var b=w.querySelector('button');
    function open(o){w.classList.toggle('open',o);b.setAttribute('aria-expanded',o)}
    b.addEventListener('click',function(){open(!w.classList.contains('open'))});
    w.addEventListener('mouseenter',function(){if(matchMedia('(hover:hover)').matches)open(true)});
    w.addEventListener('mouseleave',function(){if(matchMedia('(hover:hover)').matches)open(false)});
    w.addEventListener('keydown',function(e){if(e.key==='Escape'){open(false);b.focus()}});
  });
  document.addEventListener('click',function(e){document.querySelectorAll('.has-menu.open').forEach(function(w){if(!w.contains(e.target)){w.classList.remove('open');w.querySelector('button').setAttribute('aria-expanded','false')}})});
  // phone menu: a dialog with a focus trap; Escape or a click on the button closes it and returns focus
  var burger=document.querySelector('.burger'),mm=document.querySelector('.mobile-menu');
  if(burger&&mm){
    var items=function(){return Array.prototype.slice.call(mm.querySelectorAll('a[href],button')).filter(function(e){return e.offsetParent})};
    var setOpen=function(o){mm.hidden=!o;burger.setAttribute('aria-expanded',o);burger.classList.toggle('x',o);if(o){var f=items()[0];f&&f.focus()}};
    burger.addEventListener('click',function(){setOpen(mm.hidden)});
    document.addEventListener('keydown',function(e){
      if(mm.hidden)return;
      if(e.key==='Escape'){setOpen(false);burger.focus();return}
      if(e.key!=='Tab')return;
      var list=[burger].concat(items()),i=list.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){e.preventDefault();list[list.length-1].focus()}
      else if(!e.shiftKey&&(i===list.length-1||i<0)){e.preventDefault();list[0].focus()}});
    mm.addEventListener('click',function(e){if(e.target.closest('a[href^="#"]'))setOpen(false)});
    matchMedia('(min-width:981px)').addEventListener('change',function(m){if(m.matches&&!mm.hidden)setOpen(false)});
  }
  // GitHub stars (live, cached an hour per browser)
  var el=document.querySelector('[data-stars]');
  if(el){try{var c=JSON.parse(localStorage.getItem('shipvo.stars')||'null');if(c&&Date.now()-c.t<36e5){el.textContent=c.v;el=null}}catch(e){}
    if(el)fetch('https://api.github.com/repos/shipvo/shipvo').then(function(r){return r.json()}).then(function(d){if(typeof d.stargazers_count==='number'){var v=d.stargazers_count>=1000?(d.stargazers_count/1000).toFixed(1)+'k':String(d.stargazers_count);el.textContent=v;try{localStorage.setItem('shipvo.stars',JSON.stringify({v:v,t:Date.now()}))}catch(e){}}}).catch(function(){})}
  // live service status in the footer
  var st=document.querySelector('[data-status]');
  if(st){Promise.all([fetch('https://api.shipvo.dev/health',{cache:'no-store'}).then(function(r){return r.ok}).catch(function(){return false}),fetch('https://sim.shipvo.dev/health',{cache:'no-store'}).then(function(r){return r.ok}).catch(function(){return false})]).then(function(a){var ok=a[0]&&a[1];st.classList.add(ok?'ok':a[0]||a[1]?'warn':'down');st.querySelector('span:last-child').textContent=ok?'all systems live':a[0]||a[1]?'partial outage':'services unreachable'})}
  // copy buttons on command boxes (<pre class="term"><code>...): added here so every page gets them
  function copyText(t,b,label){
    var done=function(){b.textContent='Copied';b.classList.add('done');setTimeout(function(){b.textContent=label;b.classList.remove('done')},1400)};
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(done,function(){fallback()})}else fallback();
    function fallback(){var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy');done()}catch(e){}document.body.removeChild(a)}
  }
  document.querySelectorAll('pre.term').forEach(function(pre){
    var code=pre.querySelector('code');if(!code||pre.querySelector('.term-copy'))return;
    var b=document.createElement('button');b.type='button';b.className='term-copy';b.textContent='Copy';b.setAttribute('aria-label','Copy command');
    b.addEventListener('click',function(){copyText(code.textContent.trim(),b,'Copy')});
    // the button is placed against the box; a static box becomes relative, a sticky one stays sticky (both work)
    if(getComputedStyle(pre).position==='static'){pre.style.position='relative';pre.style.top='auto'}
    pre.classList.add('has-copy');pre.appendChild(b);
  });
  document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){var t=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=t},1400)})})});
  // series episodes: while the recap at the start plays, offer "previous episode" and "skip recap".
  // Markup: <video data-recap-end="6" data-prev="/learn/videos/#s1-e1" data-prev-title="E1 · No app">.
  // Runs after the other deferred scripts so it sees the final wrapper (docs.js adds .vid).
  function episodes(){
    document.querySelectorAll('video[data-recap-end]').forEach(function(v){
      if(v.getAttribute('data-ep-ready'))return;v.setAttribute('data-ep-ready','1');
      var start=parseFloat(v.getAttribute('data-recap-start')||'0'),end=parseFloat(v.getAttribute('data-recap-end'));
      if(!(end>start))return;
      var box=v.parentNode;
      if(!box.classList.contains('vid')){box=document.createElement('div');box.className='ep-box';v.parentNode.insertBefore(box,v);box.appendChild(v)}
      var bar=document.createElement('div');bar.className='ep-bar';bar.setAttribute('role','group');bar.setAttribute('aria-label','Recap');
      var prev=v.getAttribute('data-prev');
      if(prev){var a=document.createElement('a');a.className='ep-btn ep-prev';a.href=prev;
        a.textContent='\u25C0 Watch '+(v.getAttribute('data-prev-title')||'previous episode');
        a.addEventListener('click',function(){v.pause()});bar.appendChild(a)}
      var skip=document.createElement('button');skip.type='button';skip.className='ep-btn ep-skip';skip.textContent='Skip recap \u203A';
      skip.addEventListener('click',function(){v.currentTime=end;var p=v.play();if(p&&p.catch)p.catch(function(){});v.focus()});
      bar.appendChild(skip);box.appendChild(bar);
      // pin the bar to the video's own box, whatever width the page gives the video
      function place(){bar.style.left=v.offsetLeft+'px';bar.style.top=v.offsetTop+'px';bar.style.width=v.offsetWidth+'px'}
      if(window.ResizeObserver)new ResizeObserver(place).observe(v);window.addEventListener('resize',place);place();
      function sync(){var t=v.currentTime||0;bar.hidden=!(t>=start&&t<end-0.25)}
      ['timeupdate','seeked','loadedmetadata','play'].forEach(function(e){v.addEventListener(e,sync)});sync();
    });
  }
  if(document.readyState==='complete')episodes();else{document.addEventListener('DOMContentLoaded',episodes);window.addEventListener('load',episodes)}
})();

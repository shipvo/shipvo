(function(){
  // copy buttons
  document.querySelectorAll('.code .copy').forEach(function(b){b.addEventListener('click',function(){var t=b.closest('.code').querySelector('code').textContent;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1400)})})});
  // sidebar on phones
  var side=document.getElementById('side'),tog=document.querySelector('.side-toggle');
  if(tog)tog.addEventListener('click',function(){var o=side.classList.toggle('open');tog.setAttribute('aria-expanded',o);tog.textContent=o?'Close':'Menu'});
  // active heading in the outline
  var links=[].slice.call(document.querySelectorAll('.toc a')),hs=links.map(function(a){return document.getElementById(a.getAttribute('href').slice(1))}).filter(Boolean);
  if(hs.length&&'IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id)})}})},{rootMargin:'-70px 0px -70% 0px'});hs.forEach(function(h){io.observe(h)})}
  // search
  var inp=document.getElementById('docsearch'),out=document.getElementById('results'),idx=null,cur=-1;
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function load(){if(idx)return Promise.resolve(idx);return fetch('/docs/index.json').then(function(r){return r.json()}).then(function(d){idx=d;return d})}
  function snippet(t,q){var i=t.toLowerCase().indexOf(q);if(i<0)return t.slice(0,110);var s=Math.max(0,i-50);return (s?'…':'')+t.slice(s,i)+'<mark>'+t.slice(i,i+q.length)+'</mark>'+t.slice(i+q.length,i+90)+'…'}
  function run(){var q=inp.value.trim().toLowerCase();cur=-1;if(!q){out.hidden=true;out.innerHTML='';return}
    load().then(function(d){var rows=d.map(function(p){var hay=(p.title+' '+p.desc+' '+p.headings.join(' ')).toLowerCase(),body=p.text.toLowerCase();var score=(p.title.toLowerCase().indexOf(q)>=0?10:0)+(hay.indexOf(q)>=0?4:0)+(body.indexOf(q)>=0?1:0);return{p:p,score:score}}).filter(function(r){return r.score>0}).sort(function(a,b){return b.score-a.score}).slice(0,8);
      out.hidden=false;out.innerHTML=rows.length?rows.map(function(r){var h=r.p.headings.find(function(x){return x.toLowerCase().indexOf(q)>=0});return '<a href="/docs/'+r.p.slug+'/'+(h?'#'+h.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):'')+'">'+esc(r.p.title)+(h?' › '+esc(h):'')+'<small>'+esc(r.p.group)+' · '+snippet(esc(r.p.text),q)+'</small></a>'}).join(''):'<a><small>No matches</small></a>'});}
  if(inp){inp.addEventListener('input',run);inp.addEventListener('keydown',function(e){var as=out.querySelectorAll('a[href]');if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();cur=(cur+(e.key==='ArrowDown'?1:-1)+as.length)%as.length;as.forEach(function(a,i){a.classList.toggle('active',i===cur)})}else if(e.key==='Enter'&&cur>=0){as[cur].click()}else if(e.key==='Escape'){inp.value='';run();inp.blur()}});
    document.addEventListener('keydown',function(e){if(e.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();inp.focus()}})}
})();

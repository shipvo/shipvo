(function(){
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  var LABEL={shop:'Shops',food:'Food & drink',travel:'Travel',finance:'Finance',health:'Health',education:'Education',services:'Services',tools:'Tools',games:'Games',other:'Other'};
  var ICON={shop:'<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>',food:'<path d="M4 3v8a4 4 0 0 0 8 0V3M8 3v18M18 3v18M15 3c3 0 3 7 3 7h-3"/>',travel:'<path d="M2 16l20-6-6 10-3-5-5-1M15 20l-3-4"/>',finance:'<path d="M3 7h18v12H3zM3 11h18M7 15h3"/>',health:'<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z"/>',education:'<path d="M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',services:'<path d="M14 7a4 4 0 1 0 3 3l4 4-3 3-4-4M3 21l6-6"/>',tools:'<path d="M4 20l8-8M14 4l6 6-4 4-6-6zM4 20l-1 1"/>',games:'<path d="M6 8h12a4 4 0 0 1 4 4v2a4 4 0 0 1-7 2.6L14 16h-4l-1 .6A4 4 0 0 1 2 14v-2a4 4 0 0 1 4-4zM7 11v4M5 13h4M16 12h.01M18 14h.01"/>',other:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'};
  var svg=function(c){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICON[c]||ICON.other)+'</svg>'};
  var fmtDate=function(s){if(!s)return '—';var d=new Date(s);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})};
  var ago=function(s){if(!s)return 'never';var m=(Date.now()-new Date(s))/6e4;if(m<60)return Math.max(1,Math.round(m))+' min ago';if(m<1440)return Math.round(m/60)+' h ago';return Math.round(m/1440)+' d ago'};
  var ico=function(a,cls){return a.icon_url?'<img class="app-ico '+(cls||'')+'" src="'+esc(a.icon_url)+'" alt="" loading="lazy">':'<div class="app-ico ph '+(cls||'')+'" aria-hidden="true">'+esc(a.name.trim().slice(0,1).toUpperCase())+'</div>'};
  var badges=function(a){var b='';if(a.app_id==='tide')b+='<span class="badge verified"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>parity-verified</span> <span class="badge sample">sample app</span>';return b};
  var tagline=function(a){return a.tagline||a.tagline_m||(a.description||'').split(/[.!?]\s/)[0]||''};
  function card(a){var shots=(a.screenshots||[]).slice(0,3);return '<a class="app-card" role="listitem" href="/apps/'+esc(a.app_id)+'">'+
    '<div class="row">'+ico(a)+'<div style="min-width:0"><h3>'+esc(a.name)+'</h3><div class="tag">'+esc(tagline(a))+'</div><div class="by">'+esc(LABEL[a.category]||a.category)+' · by '+esc(a.owner)+'</div></div><span class="open">Open</span></div>'+
    (shots.length?'<div class="shots">'+shots.map(function(s){return '<img src="'+esc(s)+'" alt="" loading="lazy">'}).join('')+'</div>':'')+
    '<div class="sig"><span><b>'+esc(a.opens||0)+'</b> agent sessions</span><span>r<b>'+esc(a.latest_release)+'</b></span><span>opened <b>'+esc(ago(a.last_opened_at))+'</b></span>'+(badges(a)?'<span>'+badges(a)+'</span>':'')+'</div></a>'}
  function toast(t){var el=document.querySelector('.toast');if(!el){el=document.createElement('div');el.className='toast';document.body.appendChild(el)}el.textContent=t;el.classList.add('on');clearTimeout(el._t);el._t=setTimeout(function(){el.classList.remove('on')},1500)}
  function wireCopy(root){(root||document).querySelectorAll('[data-copy]').forEach(function(b){if(b._w)return;b._w=1;b.addEventListener('click',function(e){e.preventDefault();navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){toast('Copied')})})})}

  /* ---------- shelf ---------- */
  var grid=document.getElementById('grid');
  if(grid){
    var q=document.getElementById('q'),cats=document.getElementById('cats'),feat=document.getElementById('featured'),all=[],cat='';
    function renderCats(){var present={};all.forEach(function(a){present[a.category]=(present[a.category]||0)+1});var list=Object.keys(LABEL).filter(function(c){return present[c]});
      cats.innerHTML='<button type="button" aria-pressed="'+(cat===''?'true':'false')+'" data-c="">All <span class="mono" style="opacity:.6">'+all.length+'</span></button>'+list.map(function(c){return '<button type="button" aria-pressed="'+(cat===c?'true':'false')+'" data-c="'+c+'">'+svg(c)+LABEL[c]+' <span class="mono" style="opacity:.6">'+present[c]+'</span></button>'}).join('')}
    function rail(id,rows){var b=document.getElementById(id);if(!rows.length){b.hidden=true;return}b.hidden=false;b.querySelector('.rail').innerHTML=rows.map(card).join('')}
    function render(){var t=q.value.trim().toLowerCase();var rows=all.filter(function(a){return(!cat||a.category===cat)&&(!t||(a.app_id+' '+a.name+' '+tagline(a)+' '+a.description+' '+a.category).toLowerCase().indexOf(t)>=0)});
      var filtering=!!(t||cat);
      document.getElementById('all-title').textContent=filtering?(cat?LABEL[cat]:'Results'):'All apps';document.getElementById('all-count').textContent=rows.length+' app'+(rows.length===1?'':'s');
      if(filtering){feat.innerHTML='';rail('rail-top',[]);rail('rail-new',[])}else{
        var f=all[0];feat.innerHTML=f?'<section class="featured" aria-label="Featured app"><div class="f-text"><div class="eyebrow">Featured</div><h2>'+esc(f.name)+'</h2><p>'+esc(f.description||tagline(f))+'</p><div class="f-actions"><a class="btn primary" href="/apps/'+esc(f.app_id)+'">View listing</a><button class="btn" type="button" data-copy=\'open_app("'+esc(f.app_id)+'@latest")\'>Copy open_app</button></div><div class="sig mono small" style="color:var(--dim)">'+esc(f.opens||0)+' agent sessions · r'+esc(f.latest_release)+' · '+badges(f)+'</div></div><div class="f-art">'+((f.screenshots||[])[0]?'<img class="shot" src="'+esc(f.screenshots[0])+'" alt="">':(f.icon_url?'<img class="big-ico" src="'+esc(f.icon_url)+'" alt="">':'<div class="app-ico ph big-ico" style="width:160px;height:160px;border-radius:40px;font-size:64px">'+esc(f.name[0])+'</div>'))+'</div></section>':'';
        rail('rail-top',all.slice().sort(function(a,b){return(b.opens||0)-(a.opens||0)}).filter(function(a){return a.opens>0}).slice(0,6));
        var wk=Date.now()-7*864e5;rail('rail-new',all.filter(function(a){return new Date(a.published_at)>wk}).sort(function(a,b){return new Date(b.published_at)-new Date(a.published_at)}).slice(0,6));
      }
      grid.innerHTML=rows.length?rows.map(card).join(''):'<div class="empty" style="grid-column:1/-1"><b style="display:block;color:var(--paper);font-size:20px;margin-bottom:6px">'+(all.length?'No apps match.':'The shelf is being stocked.')+'</b>'+(all.length?'Try another word or category.':'Be first: <code>shipvo app create</code> with <code>listing.public</code> set to true.')+'</div>';
      wireCopy()}
    cats.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;cat=b.dataset.c;renderCats();render()});
    q.addEventListener('input',render);
    grid.innerHTML='<div class="empty" style="grid-column:1/-1">Loading…</div>';
    fetch('/api/apps').then(function(r){return r.json()}).then(function(d){all=d.apps||[];renderCats();render()}).catch(function(){grid.innerHTML='<div class="empty" style="grid-column:1/-1">Could not load the directory. Try again in a moment.</div>'});
  }

  /* ---------- listing ---------- */
  var root=document.getElementById('root');
  if(root&&!grid){
    var id=(location.pathname.match(/^\/apps\/([a-z0-9-]+)/)||[])[1];
    if(!id){location.replace('/apps');return}
    fetch('/api/apps/'+id).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(a){
      document.title=a.name+' — Shipvo';
      var open='open_app("'+a.app_id+'@latest")';
      var cfg=JSON.stringify({mcpServers:{shipvo:{url:'https://sim.shipvo.dev/mcp',headers:{Authorization:'Bearer <your key>'}}}},null,2);
      var shots=a.screenshots||[];
      var caps=(a.capabilities&&a.capabilities.length?a.capabilities:[]);
      var sizeKB=function(n){return n>1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB'};
      root.innerHTML=
        '<div class="crumb"><a href="/apps">Marketplace</a> / '+esc(LABEL[a.category]||a.category)+' / '+esc(a.name)+'</div>'+
        '<header class="listing-head">'+ico(a,'big')+'<div><h1>'+esc(a.name)+'</h1><div class="tag">'+esc(tagline(a))+'</div><div class="meta"><span>by '+esc(a.owner)+'</span><span>'+esc(LABEL[a.category]||a.category)+'</span>'+(a.website||a.website_m?'<a href="'+esc(a.website||a.website_m)+'" rel="noopener">website</a>':'')+'<span>'+badges(a)+'</span></div></div>'+
        '<div class="listing-actions"><button class="btn primary" type="button" data-copy=\''+esc(open)+'\'>Copy open_app</button><a class="btn" href="#try">How to open it</a></div></header>'+
        '<div class="stats"><div><b>'+esc(a.opens||0)+'</b><small>agent sessions</small></div><div><b>r'+esc(a.latest_release)+'</b><small>latest release</small></div><div><b>'+esc(a.releases||'—')+'</b><small>releases</small></div><div><b>'+esc(fmtDate(a.published_at))+'</b><small>last published</small></div><div><b>'+esc(ago(a.last_opened_at))+'</b><small>last opened</small></div></div>'+
        '<div class="shots-rail" aria-label="Screenshots">'+(shots.length?shots.map(function(s){return '<img src="'+esc(s)+'" alt="Screenshot of '+esc(a.name)+'" loading="lazy">'}).join(''):'<div class="ph">No screenshots yet.<br>An agent sees this app as an accessibility tree; screenshots are for people.</div>')+'</div>'+
        '<div class="listing-grid"><div>'+
          '<section class="block"><h2>About this app</h2><p>'+esc(a.description||'No description yet.')+'</p></section>'+
          (a.release_note&&a.release_note.headline?'<section class="block"><h2>What\'s new</h2><div class="whatsnew"><div class="r">RELEASE '+esc(a.latest_release)+' · '+esc(fmtDate(a.published_at))+'</div><b>'+esc(a.release_note.headline)+'</b>'+(a.release_note.note?'<p>'+esc(a.release_note.note)+'</p>':'')+'</div></section>':'')+
          '<section class="block"><h2>Device features</h2><div class="caps">'+(caps.length?caps.map(function(c){return '<span>'+esc(c)+'</span>'}).join(''):'<span>not declared</span>')+'</div><p style="font-size:13.5px;margin-top:10px;color:var(--dim)">In the simulator every feature is simulated and labelled so: receipts say <code>SIMULATED-</code>, the device log says <code>simulated: true</code>. No money moves.</p></section>'+
          (a.history&&a.history.length?'<section class="block"><h2>Release history</h2><table class="hist">'+a.history.map(function(h){return '<tr><td>r'+esc(h.release)+'</td><td>'+esc(new Date(h.issued_at).toLocaleString())+(h.min_shell_version?' · shell ≥ '+esc(h.min_shell_version):'')+'</td><td>'+sizeKB(h.size)+'</td></tr>'}).join('')+'</table></section>':'')+
          '<section class="block"><h2>Safety</h2><p>Published by its owner through Shipvo with a signing key the owner controls; every release is verified against that key. Shipvo reviews listings before they appear here. Opening an app spends the opener\'s sandbox minutes, not the owner\'s.</p></section>'+
        '</div><aside><div class="try" id="try"><div class="tt" role="tablist"><button role="tab" aria-selected="true" data-t="claude">Claude</button><button role="tab" aria-selected="false" data-t="cursor">Cursor</button><button role="tab" aria-selected="false" data-t="chatgpt">ChatGPT</button></div><div class="tp" id="tp"></div></div></aside></div>'+
        (a.similar&&a.similar.length?'<section class="block" style="margin-top:40px"><h2>More like this</h2><div class="similar">'+a.similar.map(function(s){return '<a href="/apps/'+esc(s.app_id)+'">'+ico(s)+'<div><b>'+esc(s.name)+'</b><span>'+esc(tagline(s)||LABEL[s.category]||s.category)+'</span></div></a>'}).join('')+'</div></section>':'');
      var tp=document.getElementById('tp'),tabs=root.querySelectorAll('.tt button');
      var panes={
        claude:'<p>Sign in once, add the server in Claude Desktop (Settings → Connectors) or Claude Code, then ask Claude to open the app.</p><div class="cmd"><span class="p">$</span><span>npx -y @shipvo/cli login</span><button type="button" data-copy="npx -y @shipvo/cli login">Copy</button></div><pre class="term">'+esc(cfg)+'</pre><div class="cmd"><span class="p">›</span><span>'+esc(open)+'</span><button type="button" data-copy=\''+esc(open)+'\'>Copy</button></div>',
        cursor:'<p>Same key. Add the server under Cursor Settings → MCP, then ask the agent to open the app.</p><div class="cmd"><span class="p">$</span><span>npx -y @shipvo/cli login</span><button type="button" data-copy="npx -y @shipvo/cli login">Copy</button></div><pre class="term">'+esc(cfg)+'</pre><div class="cmd"><span class="p">›</span><span>'+esc(open)+'</span><button type="button" data-copy=\''+esc(open)+'\'>Copy</button></div>',
        chatgpt:'<p>ChatGPT connectors cannot send headers, so the key goes in the URL. Add a custom MCP connector with this address.</p><div class="cmd"><span class="p">$</span><span>npx -y @shipvo/cli login</span><button type="button" data-copy="npx -y @shipvo/cli login">Copy</button></div><div class="cmd"><span class="p">url</span><span>https://sim.shipvo.dev/mcp/&lt;your key&gt;</span></div><div class="cmd" style="margin-top:10px"><span class="p">›</span><span>'+esc(open)+'</span><button type="button" data-copy=\''+esc(open)+'\'>Copy</button></div><div class="note">Treat the URL as a secret: it carries your key.</div>'
      };
      function pick(k){tabs.forEach(function(b){b.setAttribute('aria-selected',b.dataset.t===k)});tp.innerHTML=panes[k];wireCopy(tp)}
      tabs.forEach(function(b){b.addEventListener('click',function(){pick(b.dataset.t)})});pick('claude');wireCopy(root);
    }).catch(function(){root.innerHTML='<div class="empty"><b style="display:block;color:var(--paper);font-size:20px;margin-bottom:6px">No public app called “'+esc(id)+'”.</b>It may be private, withdrawn or still under review. <a class="link" href="/apps">See all apps</a>.</div>'});
  }
})();

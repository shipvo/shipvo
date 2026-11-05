(function(){
  var W=390,H=844,cache={};
  function releases(api,app){var k=api+'/'+app;return cache[k]||(cache[k]=fetch(api+'/'+app+'/releases.json').then(function(r){if(!r.ok)throw 0;return r.json()}))}
  function fail(el){el.classList.add('phone-failed');var f=el.querySelector('iframe');if(f)f.remove();
    el.querySelectorAll('[hidden]').forEach(function(n){n.hidden=false});
    el.querySelectorAll('.phone-links a').forEach(function(a){a.hidden=true})}
  function scale(el){var box=el.querySelector('.phone-box'),fr=el.querySelector('.phone-frame');if(!box||!fr)return;
    var s=Math.min(1,box.clientWidth/W);fr.style.transform='scale('+s+')';box.style.height=Math.round(H*s)+'px'}
  document.querySelectorAll('figure[data-phone]').forEach(function(el){
    if(el.classList.contains('phone-failed'))return;
    var api=el.dataset.api,app=el.dataset.app,rel=el.dataset.release,path=el.dataset.path;
    var f=el.querySelector('iframe'),full=el.querySelector('[data-phone-full]'),rl=el.querySelector('[data-phone-reload]');
    scale(el);if(window.ResizeObserver)new ResizeObserver(function(){scale(el)}).observe(el.querySelector('.phone-box'));else addEventListener('resize',function(){scale(el)});
    releases(api,app).then(function(d){
      var list=d.releases||[];var n=rel==='latest'?d.latest:Number(rel);
      if(!n||list.indexOf(n)<0)throw 0;
      var src=api+'/'+app+'/r'+n+path;
      if(f.getAttribute('src')!==src)f.src=src;
      full.href=src;
    }).catch(function(){fail(el)});
    rl.addEventListener('click',function(e){e.preventDefault();var s=f.getAttribute('src');if(s){f.src='about:blank';setTimeout(function(){f.src=s},30)}});
  });
})();

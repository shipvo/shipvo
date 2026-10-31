(function(){
  document.querySelectorAll('.code .copy').forEach(function(b){b.addEventListener('click',function(){var t=b.closest('.code').querySelector('code').textContent;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1400)})})});
  var u=document.querySelector('[data-copy-url]');
  if(u)u.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(location.href).then(function(){u.textContent='Copied';setTimeout(function(){u.textContent='Copy link'},1400)})});
  var tabs=[].slice.call(document.querySelectorAll('.tabs button')),cards=[].slice.call(document.querySelectorAll('#posts .pcard')),empty=document.querySelector('.empty');
  function pick(tag){var n=0;tabs.forEach(function(t){t.setAttribute('aria-selected',t.dataset.tag===tag)});cards.forEach(function(c){var on=tag==='All'||c.dataset.tags.split('|').indexOf(tag)>-1;c.hidden=!on;if(on)n++;c.classList.remove('lead')});var first=cards.filter(function(c){return !c.hidden})[0];if(first&&tag==='All')first.classList.add('lead');if(empty)empty.hidden=n>0;try{history.replaceState(null,'',tag==='All'?location.pathname:'#'+encodeURIComponent(tag))}catch(e){}}
  tabs.forEach(function(t){t.addEventListener('click',function(){pick(t.dataset.tag)})});
  var h=decodeURIComponent(location.hash.slice(1));if(h&&tabs.some(function(t){return t.dataset.tag===h}))pick(h);
})();

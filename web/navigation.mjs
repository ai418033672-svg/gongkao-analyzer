export function initPages(){
 const show=()=>{
  const current=location.hash==='#collection'?'collection':'jobs';
  document.querySelectorAll('[data-page]').forEach(el=>el.hidden=el.dataset.page!==current);
  document.querySelectorAll('[data-nav]').forEach(el=>{if(el.dataset.nav===current)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  document.title=(current==='collection'?'公告采集':'职位筛选')+' · 选职';
  const dialog=document.getElementById('dialog');if(dialog?.open)dialog.close();
  window.scrollTo(0,0);
 };
 window.addEventListener('hashchange',show);show();
}

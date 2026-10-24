// Reading position is optional enhancement; all content and anchors work without JS.
(() => {
  const nav = document.querySelector('.case-nav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  if (sections.some(section => !section)) return;
  let scheduled = false;
  let anchoredIndex = links.findIndex(link => link.hash === location.hash);
  if (anchoredIndex < 0) anchoredIndex = null;
  nav.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (links.includes(link)) anchoredIndex = links.indexOf(link);
  });
  function followScroll() { anchoredIndex = null; schedule(); }
  addEventListener('wheel', followScroll, {passive:true});
  addEventListener('touchstart', followScroll, {passive:true});
  addEventListener('pointerdown', event => { if (!nav.contains(event.target)) followScroll(); });
  addEventListener('keydown', event => { if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)) followScroll(); });
  function update() {
    scheduled = false;
    const threshold = nav.getBoundingClientRect().height + 40;
    let active = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= threshold) active = index;
    });
    // A short final section may never reach the top before the page ends.
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) {
      active = anchoredIndex ?? sections.length - 1;
    }
    links.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }
  addEventListener('scroll', schedule, {passive:true});
  addEventListener('resize', schedule);
  addEventListener('hashchange', () => {
    const index = links.findIndex(link => link.hash === location.hash);
    anchoredIndex = index >= 0 ? index : null;
    schedule();
  });
  update();
})();

// Reading position is optional enhancement; all content and anchors work without JS.
(() => {
  const nav = document.querySelector('.case-nav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  if (sections.some(section => !section)) return;
  let scheduled = false;
  function update() {
    scheduled = false;
    const threshold = nav.getBoundingClientRect().height + 40;
    let active = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= threshold) active = index;
    });
    // A short final section may never reach the top before the page ends.
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) {
      active = sections.length - 1;
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
  addEventListener('hashchange', schedule);
  update();
})();

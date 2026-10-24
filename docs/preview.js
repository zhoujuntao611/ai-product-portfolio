// Screenshots remain ordinary image links when JavaScript is unavailable.
(() => {
  document.querySelectorAll('.preview-switcher').forEach(preview => {
    const list = preview.querySelector('[role="tablist"]');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
    if (!tabs.length || panels.some(panel => !panel)) return;
    function select(index, focus = false) {
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
        panels[i].hidden = i !== index;
      });
      if (focus) tabs[index].focus();
    }
    tabs.forEach((tab, index) => {
      panels[index].setAttribute('role', 'tabpanel');
      panels[index].setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', event => {
        const next = {ArrowRight:(index + 1) % tabs.length, ArrowLeft:(index + tabs.length - 1) % tabs.length, Home:0, End:tabs.length - 1}[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(next, true);
      });
    });
    select(0);
    preview.classList.add('enhanced');
    list.hidden = false;
  });
})();

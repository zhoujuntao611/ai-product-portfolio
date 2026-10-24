// Optional image viewer. Original image links work without JavaScript.
(() => {
  if (!('HTMLDialogElement' in window)) return;
  let viewer;
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || !link.querySelector('img')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !/\.(png|jpe?g|webp)$/i.test(url.pathname)) return;
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.className = 'image-viewer';
      viewer.setAttribute('aria-labelledby', 'image-viewer-title');
      viewer.innerHTML = '<div class="viewer-toolbar"><h2 id="image-viewer-title">界面截图</h2><a target="_blank" rel="noopener noreferrer">打开原图</a><button type="button" autofocus>关闭</button></div><div class="viewer-content"><img alt=""></div>';
      document.body.append(viewer);
      viewer.querySelector('button').addEventListener('click', () => viewer.close());
      viewer.addEventListener('click', e => {
        if (e.target !== viewer) return;
        const bounds = viewer.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) viewer.close();
      });
      viewer.addEventListener('close', () => viewer.querySelector('img').removeAttribute('src'));
    }
    event.preventDefault();
    const img = viewer.querySelector('img');
    img.src = url.href;
    img.alt = link.querySelector('img').alt;
    viewer.querySelector('a').href = url.href;
    viewer.showModal();
  });
})();

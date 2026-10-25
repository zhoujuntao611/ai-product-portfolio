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
      viewer.innerHTML = '<div class="viewer-toolbar"><h2 id="image-viewer-title">界面截图</h2><button class="viewer-zoom" type="button" aria-pressed="false">原尺寸</button><a target="_blank" rel="noopener noreferrer">原图 ↗</a><button class="viewer-close" type="button" autofocus>关闭</button></div><div class="viewer-content" tabindex="0" role="region" aria-label="截图，可滚动查看细节"><img alt=""></div>';
      document.body.append(viewer);
      viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
      viewer.querySelector('.viewer-zoom').addEventListener('click', () => {
        const zoomed = viewer.classList.toggle('zoomed');
        const button = viewer.querySelector('.viewer-zoom');
        button.setAttribute('aria-pressed', String(zoomed));
        button.textContent = zoomed ? '适应窗口' : '原尺寸';
        viewer.querySelector('.viewer-content').scrollTo(0, 0);
      });
      viewer.addEventListener('click', e => {
        if (e.target !== viewer) return;
        const bounds = viewer.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) viewer.close();
      });
      viewer.addEventListener('close', () => viewer.querySelector('img').removeAttribute('src'));
    }
    event.preventDefault();
    const img = viewer.querySelector('img');
    viewer.classList.remove('zoomed');
    viewer.querySelector('.viewer-zoom').setAttribute('aria-pressed', 'false');
    viewer.querySelector('.viewer-zoom').textContent = '原尺寸';
    img.src = url.href;
    img.alt = link.querySelector('img').alt;
    viewer.querySelector('a').href = url.href;
    viewer.showModal();
    viewer.querySelector('.viewer-content').scrollTo(0, 0);
  });
})();

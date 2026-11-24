// Mobile menu toggle. Without JavaScript the navigation links stay visible.
document.documentElement.classList.add('js');
document.addEventListener('DOMContentLoaded', function () {
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');
  if (!btn || !nav) return;
  function close() { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) { close(); btn.focus(); }
  });
});

// Hero artwork animation: a short silent loop over the still image.
// Skipped when the visitor prefers reduced motion or has asked to save data.
// A Pause button is always shown while it runs, and it pauses when scrolled out of view.
document.addEventListener('DOMContentLoaded', function () {
  var art = document.querySelector('.hero-art[data-video]');
  if (!art || !window.matchMedia) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var c = navigator.connection;
  if (c && c.saveData) return;
  var img = art.querySelector('img');
  var v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
  v.preload = 'auto';
  if (img && img.currentSrc) v.poster = img.currentSrc;
  v.src = art.getAttribute('data-video');
  var hero = art.closest('.hero');
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'hero-motion'; btn.hidden = true;
  var userPaused = false;
  function label() {
    btn.innerHTML = userPaused
      ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>Play animation'
      : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>Pause animation';
  }
  label();
  btn.addEventListener('click', function () {
    userPaused = !userPaused;
    if (userPaused) v.pause(); else v.play().catch(function () {});
    label();
  });
  v.addEventListener('playing', function () { v.classList.add('on'); btn.hidden = false; }, { once: true });
  art.appendChild(v);
  if (hero) hero.appendChild(btn);
  var p = v.play(); if (p && p.catch) p.catch(function () { v.remove(); btn.remove(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (userPaused) return;
        if (e.isIntersecting) v.play().catch(function () {}); else v.pause();
      });
    }).observe(art);
  }
});

// Theme vor dem ersten Rendern setzen (verhindert Aufblitzen). Separate Datei wegen strikter CSP.
(function () {
  try {
    var t = localStorage.getItem('gs-theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();

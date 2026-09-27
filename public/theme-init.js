// Applies the saved day/night preference before the app renders (no flash of the wrong theme).
(function () {
  try {
    var saved = localStorage.getItem('nrcs-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
    if (localStorage.getItem('nrcs-reduce-motion') === '1') document.documentElement.classList.add('reduce-motion');
  } catch (e) {
    /* storage unavailable: stay in day mode */
  }
})();

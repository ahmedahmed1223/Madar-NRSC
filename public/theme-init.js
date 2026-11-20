// Applies the saved day/night, motion and text-size preferences before the app renders (no flash of the wrong look).
(function () {
  try {
    var saved = localStorage.getItem('nrcs-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
    if (localStorage.getItem('nrcs-reduce-motion') === '1') document.documentElement.classList.add('reduce-motion');
    var scale = localStorage.getItem('nrcs-text-scale');
    if (scale === 'compact' || scale === 'large' || scale === 'larger') document.documentElement.setAttribute('data-text-scale', scale);
  } catch (e) {
    /* storage unavailable: stay in day mode */
  }
})();

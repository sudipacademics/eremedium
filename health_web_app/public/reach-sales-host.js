/* Bounce /sales off non-Reach hosts to https://reach.e-remedium.in (until SPA rebuild). */
(function () {
  var REACH = 'reach.e-remedium.in';
  var host = (location.hostname || '').toLowerCase();
  var path = location.pathname || '';
  if (host === REACH) return;
  if (path !== '/sales' && path.indexOf('/sales/') !== 0) return;
  location.replace('https://' + REACH + path + (location.search || '') + (location.hash || ''));
})();

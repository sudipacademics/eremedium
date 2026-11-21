/* People HRMS is host-only on people.e-remedium.in — bounce /people off www and other hosts. */
(function () {
  if (window.__peopleHostBounce) return;
  window.__peopleHostBounce = true;

  var PEOPLE = 'people.e-remedium.in';

  function bounce() {
    var host = (location.hostname || '').toLowerCase();
    var path = location.pathname || '';
    if (host === PEOPLE) return false;
    if (path !== '/people' && path.indexOf('/people/') !== 0) return false;
    location.replace('https://' + PEOPLE + path + (location.search || '') + (location.hash || ''));
    return true;
  }

  if (bounce()) return;

  var push = history.pushState;
  history.pushState = function () {
    var result = push.apply(this, arguments);
    bounce();
    return result;
  };
  var replace = history.replaceState;
  history.replaceState = function () {
    var result = replace.apply(this, arguments);
    bounce();
    return result;
  };
  window.addEventListener('popstate', bounce);
  setInterval(bounce, 1000);
})();

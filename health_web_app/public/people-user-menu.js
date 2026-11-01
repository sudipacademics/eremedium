/* Live bridge until the People bundle is rebuilt. Skips the React menu. */
(function () {
  if (window.__peopleUserMenu) return;
  window.__peopleUserMenu = true;

  function closeMenus() {
    document.querySelectorAll('.hrms-user-menu').forEach(function (el) {
      el.remove();
    });
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeMenus();
  });

  document.addEventListener(
    'click',
    function (ev) {
      var target = ev.target;
      if (!target || !target.closest) return;
      if (target.closest('.hrms-user-menu')) return;
      var chip = target.closest('.hrms-user-chip');
      if (!chip || chip.tagName === 'BUTTON' || chip.getAttribute('data-user-menu') === 'react') {
        if (!chip) closeMenus();
        return;
      }
      if (chip.querySelector('.hrms-user-menu')) {
        closeMenus();
        return;
      }
      closeMenus();
      var menu = document.createElement('div');
      menu.className = 'hrms-user-menu';
      menu.setAttribute('role', 'menu');
      var profile = document.createElement('a');
      profile.href = '/people/profile';
      profile.setAttribute('role', 'menuitem');
      profile.textContent = 'My Profile';
      var logout = document.createElement('button');
      logout.type = 'button';
      logout.setAttribute('role', 'menuitem');
      logout.textContent = 'Log out';
      logout.addEventListener('click', function (clickEv) {
        clickEv.preventDefault();
        clickEv.stopPropagation();
        try {
          localStorage.removeItem('hec_web_session');
        } catch (err) {
          /* ignore */
        }
        location.assign('/login');
      });
      menu.appendChild(profile);
      menu.appendChild(logout);
      chip.appendChild(menu);
    },
    true,
  );
})();

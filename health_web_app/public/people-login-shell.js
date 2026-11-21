/* Standalone People / Reach / Careers / Aesthetic login shell. */
(function () {
  if (window.__peopleLoginShell) return;
  window.__peopleLoginShell = true;

  var LOGO = '/brand/smilecure-lifestyle.png?v=12';
  var ICON = '/brand/smilecure-icon.png?v=5';
  var AES_LOGO = '/aesthetic-logo.png?v=2';
  var AES_ICON = '/aesthetic-icon.png?v=1';
  var PEOPLE_NAME = 'People Management - SLPL';
  var AES_NAME = 'Remedium Aesthetic';

  var HOSTS = {
    'people.e-remedium.in': {
      kind: 'people',
      title: PEOPLE_NAME,
      kicker: PEOPLE_NAME,
      subtitle: 'Employee portal — sign in with your work email and the password issued by HR.',
      brand: true,
      favicon: true,
    },
    'reach.e-remedium.in': {
      kind: 'reach',
      title: 'Reach Portal',
      kicker: 'Reach Portal',
      subtitle: 'Field sales — sign in with your Reach email and the password issued by your administrator.',
      brand: false,
      favicon: false,
    },
    'career.e-remedium.in': {
      kind: 'careers',
      title: 'Careers Portal',
      kicker: 'Careers',
      subtitle: 'Applicants: mobile OTP. HR staff: email and password.',
      brand: false,
      favicon: false,
    },
    'aesthetics.e-remedium.in': {
      kind: 'aesthetics',
      title: AES_NAME,
      kicker: 'Clinic console',
      subtitle: 'Clinic staff — sign in with your work email and the password issued by HR.',
      brand: true,
      favicon: true,
      logo: AES_LOGO,
      icon: AES_ICON,
      brandAlt: AES_NAME,
      brandSub: 'Clinic console',
      foot: 'Access is managed by HR in People HRMS → Portal Access → Aesthetic Backend.',
      theme: '#0f766e',
    },
  };

  function meta() {
    var host = (location.hostname || '').toLowerCase();
    if (HOSTS[host]) return HOSTS[host];
    // Path-mounted /people on www until bounce completes — still brand the shell.
    var path = location.pathname || '';
    if (path === '/people' || path.indexOf('/people/') === 0) {
      return HOSTS['people.e-remedium.in'];
    }
    return null;
  }

  function isAuthPath() {
    var p = location.pathname || '';
    return (
      p === '/login' ||
      p.indexOf('/login/') === 0 ||
      p === '/forgot-password' ||
      p.indexOf('/forgot-password') === 0 ||
      p === '/oauth/callback'
    );
  }

  function applyFavicon() {
    var m = meta();
    if (!m || !m.favicon) return;
    var href = m.icon || ICON;
    var links = document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"],link[rel="shortcut icon"]');
    if (!links.length) {
      var icon = document.createElement('link');
      icon.rel = 'icon';
      icon.type = 'image/png';
      icon.href = href;
      document.head.appendChild(icon);
      var apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      apple.href = href;
      document.head.appendChild(apple);
      return;
    }
    for (var i = 0; i < links.length; i++) {
      links[i].href = href;
      if (links[i].rel === 'icon' || links[i].rel === 'shortcut icon') links[i].type = 'image/png';
    }
    var theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute('content', m.theme || '#0b3a3b');
    var appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appTitle) appTitle.setAttribute('content', m.title || PEOPLE_NAME);
  }

  function ensureBrand(panel, m) {
    if (!panel) return;
    var existing = panel.querySelector('[data-pls-brand]');
    if (existing) {
      if (m.brand && !existing.querySelector('img.pls-logo')) {
        existing.remove();
      } else {
        return;
      }
    }
    var brand = document.createElement('div');
    brand.className = 'pls-brand' + (m.brand ? ' pls-brand-logo' : '');
    brand.setAttribute('data-pls-brand', '1');
    if (m.brand) {
      brand.innerHTML =
        '<div class="pls-logo-wrap">' +
        '<img class="pls-logo" src="' +
        (m.logo || LOGO) +
        '" alt="' +
        (m.brandAlt || 'Smilecure Lifestyle Private Limited') +
        '" />' +
        '</div>' +
        '<p class="pls-brand-sub">' +
        (m.brandSub || PEOPLE_NAME) +
        '</p>';
    } else {
      var mark = m.kind === 'reach' ? 'RP' : 'CR';
      brand.innerHTML =
        '<div class="pls-brand-mark" aria-hidden="true">' +
        mark +
        '</div><span><strong>' +
        m.title +
        '</strong><small>A unit of Smilecure Lifestyle Pvt. Ltd.</small></span>';
    }
    panel.insertBefore(brand, panel.firstChild);
  }

  function ensureFoot(panel, m) {
    if (!panel || panel.querySelector('[data-pls-foot]')) return;
    var foot = document.createElement('p');
    foot.className = 'pls-foot';
    foot.setAttribute('data-pls-foot', '1');
    if (m.foot) {
      foot.textContent = m.foot;
    } else if (m.kind === 'people') {
      foot.textContent = 'Access is managed by HR in People HRMS → Portal Access.';
    } else if (m.kind === 'reach') {
      foot.textContent = 'Access is managed by HR in People HRMS → Portal Access → Reach / Sales.';
    } else {
      foot.textContent = 'Authorized staff and applicants only.';
    }
    panel.appendChild(foot);
  }

  function paintSidebarBrand() {
    var m = meta();
    if (!m || !m.brand) return;
    var link =
      document.querySelector('aside.hrms-sidebar a.hrms-brand') ||
      document.querySelector('.hrms-sidebar .hrms-brand') ||
      document.querySelector('a.hrms-brand') ||
      document.querySelector('aside a[href="/people"]');
    if (!link) return;
    var logoImg = link.querySelector('img.pls-hrms-logo');
    var hasLogo = !!logoImg;
    var hasPlate = !!link.querySelector('div.pls-hrms-logo-plate');
    var hasWhiteLogo = !!(
      logoImg &&
      /smilecure-lifestyle\.png/.test(logoImg.getAttribute('src') || '') &&
      !/glow/.test(logoImg.getAttribute('src') || '')
    );
    var text = (link.textContent || '').replace(/\s+/g, ' ').trim();
    var label = (link.querySelector('.pls-hrms-label') || {}).textContent || '';
    var needs =
      !hasLogo ||
      !hasPlate ||
      !hasWhiteLogo ||
      /Remedium/i.test(text) ||
      /Process/i.test(text) ||
      /People HRMS/i.test(label) ||
      /people management SLPL/i.test(label) ||
      link.getAttribute('data-pls-logo') !== '1';
    if (!needs && hasLogo) {
      link.classList.add('pls-hrms-brand');
      return;
    }
    link.setAttribute('data-pls-logo', '1');
    link.classList.add('pls-hrms-brand');
    link.innerHTML =
      '<div class="pls-hrms-logo-plate">' +
      '<img class="pls-hrms-logo" src="' +
      LOGO +
      '" alt="Smilecure Lifestyle Private Limited" />' +
      '</div>' +
      '<span class="pls-hrms-label">' + PEOPLE_NAME + '</span>';
  }

  function paint() {
    var m = meta();
    applyFavicon();
    paintSidebarBrand();

    if (m && (m.kind === 'people' || m.kind === 'aesthetics')) {
      var wantTitle = isAuthPath() ? m.title + ' · Sign in' : m.title;
      if (document.title !== wantTitle) document.title = wantTitle;
    }

    var on = !!(m && isAuthPath());
    document.documentElement.classList.toggle('pls-auth', on);
    document.documentElement.classList.toggle('pls-people', on && m && m.kind === 'people');
    document.documentElement.classList.toggle('pls-reach', on && m && m.kind === 'reach');
    document.documentElement.classList.toggle('pls-aesthetics', on && m && m.kind === 'aesthetics');
    if (!on) return;

    var kicker = document.querySelector('.auth-kicker');
    if (kicker) {
      if (m.brand) kicker.hidden = true;
      else if (kicker.textContent.trim() !== m.kicker) kicker.textContent = m.kicker;
    }

    var muted = document.querySelector('.auth-panel > .hv-muted, .auth-panel > p.hv-muted');
    if (muted) muted.textContent = m.subtitle;

    var h1 = document.querySelector('.auth-panel h1');
    if (h1 && /sign in/i.test(h1.textContent || '')) h1.textContent = 'Sign in';

    var panel = document.querySelector('.auth-panel');
    ensureBrand(panel, m);
    ensureFoot(panel, m);

    /* Staff-only: hide patient Google / OTP chrome that the shared LoginPage still paints. */
    document.querySelectorAll(
      '.auth-modes, .auth-trust, .auth-google, .oauth-google, .btn-google, button.btn-google, button.auth-mode, .auth-or, .auth-divider',
    ).forEach(function (node) {
      node.style.display = 'none';
    });
    document.querySelectorAll('.auth-panel button, .auth-panel a, .auth-panel p, .auth-panel span, .auth-panel div').forEach(function (el) {
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (
        t.indexOf('continue with google') >= 0 ||
        t === 'or' ||
        t.indexOf('mobile otp') >= 0 ||
        t.indexOf('create account') >= 0 ||
        t.indexOf('sign up') >= 0
      ) {
        el.style.display = 'none';
      }
    });

    var visualCopy = document.querySelector('.auth-visual-copy');
    if (visualCopy) {
      visualCopy.innerHTML = '<strong>' + m.title + '</strong><p>' + m.subtitle + '</p>';
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      paint();
    }, 40);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  setInterval(function () {
    var want = !!(meta() && isAuthPath());
    if (document.documentElement.classList.contains('pls-auth') !== want) paint();
    else paintSidebarBrand();
  }, 800);
  applyFavicon();
  paint();
})();

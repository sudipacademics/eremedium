/* Search, scroll, and a filter panel on each Report Lifecycle table. */
(function () {
  var saved = {};
  var opened = {};
  var filters = {};

  function onPage() {
    return location.pathname.indexOf('/dashboard/report-lifecycle') === 0;
  }

  function titleOf(card) {
    var heading = card.querySelector('.rl2-sec-title h3');
    return heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function cardByTitle(key) {
    var cards = document.querySelectorAll('.rl2-sec');
    for (var i = 0; i < cards.length; i++) {
      if (titleOf(cards[i]) === key) return cards[i];
    }
    return null;
  }

  function dataRows(card) {
    return Array.prototype.filter.call(card.querySelectorAll('tbody tr'), function (row) {
      return !row.querySelector('.lt-empty');
    });
  }

  function headerIndex(card, name) {
    var heads = card.querySelectorAll('thead th');
    var needle = name.toLowerCase();
    for (var i = 0; i < heads.length; i++) {
      if ((heads[i].textContent || '').toLowerCase().indexOf(needle) !== -1) return i;
    }
    return -1;
  }

  function cellText(row, index) {
    if (index < 0 || !row.children[index]) return '';
    var cell = row.children[index];
    return (cell.getAttribute('title') || cell.innerText || '').trim();
  }

  function parseDate(text) {
    if (!text || text === '—') return null;
    var direct = new Date(text.replace(/,/g, ''));
    if (!isNaN(direct.getTime())) return direct;
    var match = text.toLowerCase().match(/(\d+)\s+(minute|hour|day|week|month|year)/);
    if (!match) return null;
    var amount = parseInt(match[1], 10);
    var now = new Date();
    if (match[2] === 'month') {
      now.setMonth(now.getMonth() - amount);
      return now;
    }
    if (match[2] === 'year') {
      now.setFullYear(now.getFullYear() - amount);
      return now;
    }
    var unit = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[match[2]];
    return unit ? new Date(Date.now() - amount * unit) : null;
  }

  function dayStamp(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function stateFor(key) {
    if (!filters[key]) filters[key] = { from: '', to: '', test: '', applied: null };
    return filters[key];
  }

  function rowVisible(row, card, query, applied) {
    if (query && (row.innerText || '').toLowerCase().indexOf(query) === -1) return false;
    if (!applied) return true;
    if (applied.test) {
      var tests = cellText(row, headerIndex(card, 'test')).toLowerCase();
      if (tests.indexOf(applied.test.toLowerCase()) === -1) return false;
    }
    if (applied.from || applied.to) {
      var dateIndex = headerIndex(card, 'received');
      if (dateIndex < 0) dateIndex = headerIndex(card, 'updated');
      if (dateIndex < 0) dateIndex = headerIndex(card, 'dispatched');
      var when = parseDate(cellText(row, dateIndex));
      if (!when) return false;
      var day = dayStamp(when);
      if (applied.from && day < dayStamp(new Date(applied.from + 'T00:00:00'))) return false;
      if (applied.to && day > dayStamp(new Date(applied.to + 'T00:00:00'))) return false;
    }
    return true;
  }

  function currentQuery(card) {
    var key = titleOf(card);
    var input = card.querySelector('[data-rl-own-search]');
    if (input) return input.value || '';
    return saved[key] || '';
  }

  function filterCard(card, raw) {
    var key = titleOf(card);
    var query = (raw == null ? currentQuery(card) : raw).trim().toLowerCase();
    var applied = stateFor(key).applied;
    var active = !!(query || (applied && (applied.from || applied.to || applied.test)));
    var matched = 0;
    dataRows(card).forEach(function (row) {
      var show = rowVisible(row, card, query, applied);
      row.hidden = !show;
      if (show) matched += 1;
    });
    var wrap = card.querySelector('.lt-table-wrap');
    var note = card.querySelector('[data-rl-nomatch]');
    if (active && !matched && wrap) {
      if (!note) {
        note = document.createElement('p');
        note.className = 'rl-no-match';
        note.setAttribute('data-rl-nomatch', '1');
        note.textContent = 'No rows match your filter.';
        wrap.appendChild(note);
      }
    } else if (note) {
      note.remove();
    }
    var button = card.querySelector('[data-rl-filter]');
    if (button) button.classList.toggle('is-on', !!(applied && (applied.from || applied.to || applied.test)));
  }

  function onSearch(card, input) {
    var key = titleOf(card);
    saved[key] = input.value;
    var button = card.querySelector('.rl2-viewall');
    if (input.value.trim() && button && /view all/i.test(button.textContent || '')) {
      button.click();
      return;
    }
    filterCard(card, input.value);
  }

  function closePanels() {
    document.querySelectorAll('[data-rl-panel]').forEach(function (panel) {
      panel.remove();
    });
  }

  function testsIn(card) {
    var index = headerIndex(card, 'test');
    var seen = [];
    dataRows(card).forEach(function (row) {
      cellText(row, index).split(',').forEach(function (part) {
        var name = part.trim();
        if (name && name !== '—' && seen.indexOf(name) === -1) seen.push(name);
      });
    });
    seen.sort();
    return seen;
  }

  function openPanel(card, button) {
    closePanels();
    var key = titleOf(card);
    var state = stateFor(key);
    var panel = document.createElement('div');
    panel.className = 'rl-filter-panel';
    panel.setAttribute('data-rl-panel', '1');
    panel.innerHTML =
      '<div class="rl-filter-head"><h4>Filter</h4></div>' +
      '<div class="rl-filter-dates">' +
      '<label>Date range — from<input type="date" data-rl-from /></label>' +
      '<label>Date range — to<input type="date" data-rl-to /></label>' +
      '</div>' +
      '<label>Test filter<input type="text" data-rl-test list="rl-tests-' +
      key.replace(/[^a-z0-9]+/gi, '-') +
      '" placeholder="Type or pick a test" /></label>' +
      '<datalist id="rl-tests-' +
      key.replace(/[^a-z0-9]+/gi, '-') +
      '"></datalist>' +
      '<div class="rl-filter-actions">' +
      '<button type="button" class="is-reset" data-rl-reset>Reset filter</button>' +
      '<button type="button" class="is-apply" data-rl-apply>Apply filter</button>' +
      '<button type="button" class="is-close" data-rl-close>Close</button>' +
      '</div>';
    panel.querySelector('[data-rl-from]').value = state.from || '';
    panel.querySelector('[data-rl-to]').value = state.to || '';
    panel.querySelector('[data-rl-test]').value = state.test || '';
    var list = panel.querySelector('datalist');
    testsIn(card).forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      list.appendChild(option);
    });
    panel.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    panel.querySelector('[data-rl-close]').addEventListener('click', function (event) {
      event.stopPropagation();
      closePanels();
    });
    panel.querySelector('[data-rl-reset]').addEventListener('click', function (event) {
      event.stopPropagation();
      state.from = '';
      state.to = '';
      state.test = '';
      state.applied = null;
      panel.querySelector('[data-rl-from]').value = '';
      panel.querySelector('[data-rl-to]').value = '';
      panel.querySelector('[data-rl-test]').value = '';
      var live = cardByTitle(key);
      if (live) filterCard(live);
    });
    panel.querySelector('[data-rl-apply]').addEventListener('click', function (event) {
      event.stopPropagation();
      state.from = panel.querySelector('[data-rl-from]').value;
      state.to = panel.querySelector('[data-rl-to]').value;
      state.test = panel.querySelector('[data-rl-test]').value.trim();
      state.applied = state.from || state.to || state.test ? { from: state.from, to: state.to, test: state.test } : null;
      var live = cardByTitle(key);
      var viewAll = live && live.querySelector('.rl2-viewall');
      if (state.applied && viewAll && /view all/i.test(viewAll.textContent || '')) {
        opened[key] = true;
        viewAll.click();
      }
      if (live) filterCard(live);
      closePanels();
    });
    document.body.appendChild(panel);
    var rect = button.getBoundingClientRect();
    var width = panel.offsetWidth || 340;
    var left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    var top = rect.bottom + 8;
    if (top + panel.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - panel.offsetHeight - 8);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function mountFilter(card) {
    var tools = card.querySelector('.rl2-sec-tools');
    if (!tools || tools.querySelector('[data-rl-filter]')) return;
    var key = titleOf(card);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'rl-filter-btn';
    button.setAttribute('data-rl-filter', '1');
    button.textContent = 'Filter';
    var applied = stateFor(key).applied;
    if (applied && (applied.from || applied.to || applied.test)) button.classList.add('is-on');
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      event.preventDefault();
      var open = document.querySelector('[data-rl-panel]');
      if (open && open.getAttribute('data-rl-for') === key) {
        closePanels();
        return;
      }
      openPanel(card, button);
      var panel = document.querySelector('[data-rl-panel]');
      if (panel) panel.setAttribute('data-rl-for', key);
    });
    var search = tools.querySelector('.rl2-search');
    if (search) search.insertAdjacentElement('afterend', button);
    else tools.insertBefore(button, tools.firstChild);
  }

  function lockScroll(card) {
    var wrap = card.querySelector('.lt-table-wrap');
    var table = card.querySelector('table');
    if (!wrap && table && table.parentElement) {
      wrap = document.createElement('div');
      wrap.className = 'lt-table-wrap';
      table.parentElement.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
    if (!wrap) return;
    wrap.style.setProperty('max-height', '280px', 'important');
    wrap.style.setProperty('overflow-x', 'auto', 'important');
    wrap.style.setProperty('overflow-y', 'scroll', 'important');
    var key = titleOf(card);
    var button = card.querySelector('.rl2-viewall');
    if (!opened[key] && button && /view all/i.test(button.textContent || '')) {
      opened[key] = true;
      button.click();
    }
  }

  function mount(card) {
    lockScroll(card);
    mountFilter(card);
    var tools = card.querySelector('.rl2-sec-tools');
    if (!tools || tools.querySelector('input')) {
      var key = titleOf(card);
      if (saved[key] || (stateFor(key).applied && (stateFor(key).applied.from || stateFor(key).applied.to || stateFor(key).applied.test))) {
        filterCard(card);
      }
      return;
    }
    var key = titleOf(card);
    var label = document.createElement('label');
    label.className = 'rl2-search';
    var ns = 'http://www.w3.org/2000/svg';
    var icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    var circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '11');
    circle.setAttribute('r', '7');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'm20 20-3.5-3.5');
    icon.appendChild(circle);
    icon.appendChild(path);
    var input = document.createElement('input');
    input.setAttribute('data-rl-own-search', '1');
    input.type = 'search';
    input.placeholder = 'Search this table…';
    input.setAttribute('aria-label', 'Search ' + (key || 'this table'));
    input.value = saved[key] || '';
    input.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    input.addEventListener('input', function () {
      onSearch(card, input);
    });
    label.appendChild(icon);
    label.appendChild(input);
    tools.insertBefore(label, tools.firstChild);
    var filterBtn = tools.querySelector('[data-rl-filter]');
    if (filterBtn) label.insertAdjacentElement('afterend', filterBtn);
    if (input.value || stateFor(key).applied) filterCard(card, input.value);
  }

  function scan() {
    if (!onPage()) return;
    document.querySelectorAll('.rl2-sec').forEach(mount);
  }

  document.addEventListener(
    'click',
    function (event) {
      if (!onPage()) return;
      if (!event.target.closest('[data-rl-panel]') && !event.target.closest('[data-rl-filter]')) closePanels();
      var button = event.target && event.target.closest ? event.target.closest('.lt-kebab') : null;
      if (!button) return;
      setTimeout(function () {
        var pop = button.parentElement && button.parentElement.querySelector('.lt-row-menu-pop');
        if (!pop) return;
        var rect = button.getBoundingClientRect();
        pop.style.position = 'fixed';
        pop.style.top = rect.bottom + 4 + 'px';
        pop.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
        pop.style.left = 'auto';
        pop.style.zIndex = '80';
      }, 0);
    },
    true,
  );

  var timer = 0;
  var observer = new MutationObserver(function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(scan, 40);
  });

  function start() {
    scan();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

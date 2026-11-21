/* Field Marketing Performance Check — dashboard UI over live portal activity. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var ROOT_ID = 'reach-team-perf-root';
  var PANEL_ATTR = 'data-rtp-panel';
  var COMPLETION_FIELDS = ['purpose', 'outcome', 'visit_status', 'lead', 'duration_minutes', 'gps', 'notes', 'photo'];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysAgoIso(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function call(method, data) {
    var body = new URLSearchParams(data || {});
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: body,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : json;
        if (!m || m.status === 'error') {
          throw new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
        }
        return m.data !== undefined ? m.data : m;
      });
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        resolve(result.indexOf(',') >= 0 ? result.split(',')[1] : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function downloadText(filename, text, mime) {
    var bom = '\ufeff';
    var blob = new Blob([bom + (text || '')], { type: mime || 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function entryDate(r) {
    var raw = (r && (r.activity_date || r.visit_date || r.creation)) || '';
    var text = String(raw);
    if (text.length >= 10 && text.charAt(4) === '-') return text.slice(0, 10);
    return text;
  }

  function excelText(v) {
    var s = String(v == null ? '' : v).trim();
    return s ? "'" + s : '';
  }

  function hasVal(v) {
    return String(v == null ? '' : v).trim() !== '';
  }

  function visitHasGps(r) {
    var lat = Number(r.latitude);
    var lng = Number(r.longitude);
    return isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
  }

  function visitCompletion(r) {
    var checks = {
      purpose: hasVal(r.purpose),
      outcome: hasVal(r.outcome),
      visit_status: hasVal(r.visit_status),
      lead: hasVal(r.lead),
      duration_minutes: hasVal(r.duration_minutes) && Number(r.duration_minutes) > 0,
      gps: visitHasGps(r),
      notes: hasVal(r.notes),
      photo: hasVal(r.photo),
    };
    var filled = 0;
    COMPLETION_FIELDS.forEach(function (k) {
      if (checks[k]) filled += 1;
    });
    return {
      checks: checks,
      pct: Math.round((filled / COMPLETION_FIELDS.length) * 100),
      filled: filled,
      total: COMPLETION_FIELDS.length,
    };
  }

  function fmtDayLabel(iso) {
    if (!iso || String(iso).length < 10) return iso || '—';
    try {
      var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function fmtDateTime(r) {
    var day = entryDate(r);
    var t = String(r.visit_time || '').trim();
    if (!t && r.creation && String(r.creation).length > 10) {
      try {
        var d = new Date(r.creation);
        t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      } catch (e) {}
    }
    return fmtDayLabel(day) + (t ? ', ' + t : '');
  }

  function initials(name) {
    var parts = String(name || 'E')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'E';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function purposeClass(p) {
    var s = String(p || '').toLowerCase();
    if (s.indexOf('follow') >= 0) return 'purple';
    if (s.indexOf('meet') >= 0 || s.indexOf('lead') >= 0) return 'blue';
    return 'gray';
  }

  function outcomeClass(o) {
    var s = String(o || '').toLowerCase();
    if (s.indexOf('positive') >= 0 || s.indexOf('won') >= 0 || s.indexOf('interested') >= 0) return 'green';
    if (s.indexOf('neutral') >= 0 || s.indexOf('pending') >= 0) return 'amber';
    if (s.indexOf('negative') >= 0 || s.indexOf('lost') >= 0) return 'gray';
    return hasVal(o) ? 'green' : 'gray';
  }

  function statusClass(s) {
    var v = String(s || '').toLowerCase();
    if (v.indexOf('complete') >= 0) return 'green';
    if (v.indexOf('progress') >= 0) return 'amber';
    if (v.indexOf('cancel') >= 0) return 'gray';
    return hasVal(s) ? 'blue' : 'gray';
  }

  function photoUrl(photo) {
    var p = String(photo || '').trim();
    if (!p) return '';
    if (/^https?:\/\//i.test(p) || p.indexOf('data:') === 0) return p;
    return p.charAt(0) === '/' ? p : '/' + p;
  }

  function buildPortalCsvFromState() {
    var headers = [
      'Entry Type',
      'Date',
      'Employee',
      'Rep Code',
      'Record ID',
      'Lead Name',
      'Company / Franchise',
      'Contact Person / Owner',
      'Phone',
      'Email',
      'Address',
      'City',
      'District',
      'Subdivision',
      'Pincode',
      'Territory / Area',
      'Branch Code',
      'Purpose',
      'Outcome',
      'Duration Minutes',
      'Visit Time',
      'Visit Status',
      'Status',
      'Lead Source',
      'Linked Lead ID',
      'Latitude',
      'Longitude',
      'Photo URL',
      'Notes',
      'Created At',
      'Sales Rep ID',
    ];
    var lines = [headers.join(',')];
    function push(cols) {
      lines.push(cols.map(csvEscape).join(','));
    }
    (st.activity.leads || []).forEach(function (r) {
      var day = entryDate(r);
      push([
        'Lead',
        day,
        r.full_name,
        r.rep_code,
        r.name,
        r.lead_name,
        r.company_name,
        r.contact_person,
        excelText(r.phone),
        r.email,
        r.address,
        r.city,
        r.district,
        r.subdivision,
        excelText(r.pincode),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        r.status,
        r.lead_source,
        '',
        r.latitude,
        r.longitude,
        '',
        r.notes,
        r.creation || day,
        r.sales_rep,
      ]);
    });
    (st.activity.visits || []).forEach(function (r) {
      var day = entryDate(r);
      push([
        'Visit',
        day,
        r.full_name,
        r.rep_code,
        r.name,
        r.lead_name,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        r.purpose,
        r.outcome,
        r.duration_minutes,
        r.visit_time,
        r.visit_status,
        '',
        '',
        r.lead,
        r.latitude,
        r.longitude,
        r.photo,
        r.notes,
        r.creation || day,
        r.sales_rep,
      ]);
    });
    (st.activity.onboardings || []).forEach(function (r) {
      var day = entryDate(r);
      push([
        'Onboarding',
        day,
        r.full_name,
        r.rep_code,
        r.name,
        '',
        r.franchise_name,
        r.owner_name,
        excelText(r.phone),
        r.email,
        r.address,
        '',
        '',
        '',
        '',
        r.territory_region,
        r.proposed_branch_code,
        '',
        '',
        '',
        '',
        '',
        r.status,
        '',
        r.lead,
        '',
        '',
        '',
        r.notes,
        r.creation || day,
        r.sales_rep,
      ]);
    });
    return {
      csv: lines.join('\r\n'),
      count: (st.activity.leads || []).length + (st.activity.visits || []).length + (st.activity.onboardings || []).length,
      filename:
        'team-portal-activity-' +
        (st.activity.date_from || st.dateFrom || 'from') +
        '-to-' +
        (st.activity.date_to || st.dateTo || 'to') +
        '.csv',
    };
  }

  function buildEmployeeSummaryCsv() {
    var headers = ['Employee', 'Rep Code', 'Leads', 'Visits', 'Onboardings', 'Active days', 'Total'];
    var lines = [headers.join(',')];
    (st.activity.by_employee || []).forEach(function (r) {
      lines.push(
        [r.full_name, r.rep_code, r.leads_count || 0, r.visits_count || 0, r.onboardings_count || 0, r.days_active || 0, r.total || 0]
          .map(csvEscape)
          .join(','),
      );
    });
    return {
      csv: lines.join('\r\n'),
      count: (st.activity.by_employee || []).length,
      filename:
        'team-by-employee-' +
        (st.activity.date_from || st.dateFrom || 'from') +
        '-to-' +
        (st.activity.date_to || st.dateTo || 'to') +
        '.csv',
    };
  }

  function downloadBase64(filename, b64, mime) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.bin';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function downloadEmployeePack(salesRep, empName) {
    if (!salesRep) {
      setMsg('Missing employee id', 'error');
      return;
    }
    setMsg('Preparing ZIP for ' + (empName || salesRep) + '…', 'ok');
    call(
      'download_sales_team_employee_pack',
      rangeBody({
        sales_rep: salesRep,
      }),
    )
      .then(function (data) {
        downloadBase64(data.filename || 'employee.zip', data.file_content, data.content_type || 'application/zip');
        setMsg(
          'Downloaded ' +
            (data.employee || empName || 'employee') +
            ': ' +
            (data.count || 0) +
            ' entries' +
            (data.photo_count ? ', ' + data.photo_count + ' photo(s)' : ''),
          'ok',
        );
      })
      .catch(function (err) {
        try {
          var filtered = {
            leads: (st.activity.leads || []).filter(function (r) {
              return r.sales_rep === salesRep;
            }),
            visits: (st.activity.visits || []).filter(function (r) {
              return r.sales_rep === salesRep;
            }),
            onboardings: (st.activity.onboardings || []).filter(function (r) {
              return r.sales_rep === salesRep;
            }),
          };
          var saved = {
            leads: st.activity.leads,
            visits: st.activity.visits,
            onboardings: st.activity.onboardings,
          };
          st.activity.leads = filtered.leads;
          st.activity.visits = filtered.visits;
          st.activity.onboardings = filtered.onboardings;
          var local = buildPortalCsvFromState();
          st.activity.leads = saved.leads;
          st.activity.visits = saved.visits;
          st.activity.onboardings = saved.onboardings;
          if (local.count > 0) {
            downloadText(
              (empName || 'employee').replace(/[^\w.-]+/g, '_') + '_entries.csv',
              local.csv,
              'text/csv;charset=utf-8',
            );
            setMsg(
              'ZIP failed (' +
                (err.message || 'error') +
                '). Downloaded CSV with ' +
                local.count +
                ' entries (photos only in ZIP).',
              'error',
            );
            return;
          }
        } catch (e2) {}
        setMsg(err.message || 'Employee download failed', 'error');
      });
  }

  var st = {
    busy: false,
    message: '',
    tone: '',
    isManager: false,
    dateFrom: '',
    dateTo: '',
    datesApplied: false,
    bootstrapped: false,
    tab: 'visits',
    page: 1,
    pageSize: 10,
    filters: {
      employee: '',
      territory: '',
      visitStatus: '',
      purpose: '',
    },
    reports: [],
    activity: {
      counts: { leads: 0, visits: 0, onboardings: 0, employees: 0 },
      today_counts: { leads: 0, visits: 0, onboardings: 0 },
      daily: [],
      by_employee: [],
      leads: [],
      visits: [],
      onboardings: [],
      prefill: {},
      date_from: '',
      date_to: '',
    },
    files: [],
    form: {
      activity_date: todayIso(),
      title: 'Daily field activity',
      doctors_met: '0',
      visits_done: '0',
      samples_collected: '0',
      km_traveled: '0',
      location_note: '',
      activity_summary: '',
    },
  };

  function onSalesMap() {
    var path = location.pathname || '';
    return path === '/sales/map' || path.indexOf('/sales/map') === 0;
  }

  function mountPoint() {
    return document.querySelector('.sales-layout .b2b-main, .sales-layout main, main');
  }

  function setMsg(text, tone) {
    st.message = text || '';
    st.tone = tone || '';
    render();
  }

  function applyPrefill(force) {
    var p = (st.activity && st.activity.prefill) || {};
    if (force || !Number(st.form.visits_done)) st.form.visits_done = String(p.visits_done || 0);
    if (force || !Number(st.form.doctors_met)) st.form.doctors_met = String(p.doctors_met || 0);
    if (force || !Number(st.form.samples_collected)) {
      st.form.samples_collected = String(p.samples_collected || p.leads_uploaded || 0);
    }
  }

  function rangeBody(extra, forceDates) {
    var body = Object.assign({}, extra || {});
    // Only send client dates when user applied a filter — browser clock may be wrong.
    if (forceDates || st.datesApplied) {
      if (st.dateFrom) body.date_from = st.dateFrom;
      if (st.dateTo) body.date_to = st.dateTo;
    }
    return body;
  }

  function shiftIso(iso, days) {
    try {
      var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    } catch (e) {
      return iso;
    }
  }

  function loadAll(forceDates) {
    return Promise.all([
      call('get_sales_team_performance_reports', rangeBody({ limit: 200 }, forceDates)),
      call('get_sales_team_portal_activity', rangeBody({ limit: 5000 }, forceDates)),
    ])
      .then(function (rows) {
        var reports = rows[0] || {};
        var activity = rows[1] || {};
        st.isManager = !!(reports.is_manager || activity.is_manager);
        st.reports = reports.reports || [];
        st.activity = activity;
        if (activity.date_from) st.dateFrom = activity.date_from;
        if (activity.date_to) st.dateTo = activity.date_to;
        // First paint: expand to last 31 days using SERVER end date (ignore wrong browser clock).
        if (!st.bootstrapped && activity.date_to) {
          st.bootstrapped = true;
          st.dateTo = activity.date_to;
          st.dateFrom = shiftIso(activity.date_to, -30);
          st.datesApplied = true;
          st.page = 1;
          return loadAll(true);
        }
        st.page = 1;
        applyPrefill(true);
        setMsg('', '');
      })
      .catch(function (err) {
        setMsg(err.message || 'Failed to load team activity', 'error');
      });
  }

  function allVisits() {
    return st.activity.visits || [];
  }

  function uniqueOptions(getter) {
    var seen = {};
    var out = [];
    allVisits().forEach(function (r) {
      var v = String(getter(r) || '').trim();
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    out.sort(function (a, b) {
      return a.localeCompare(b);
    });
    return out;
  }

  function filteredVisits() {
    var f = st.filters;
    return allVisits()
      .filter(function (r) {
        if (f.employee && r.sales_rep !== f.employee && r.full_name !== f.employee) return false;
        if (f.visitStatus && String(r.visit_status || '') !== f.visitStatus) return false;
        if (f.purpose && String(r.purpose || '') !== f.purpose) return false;
        if (f.territory) {
          var terr = String(r.territory || r.city || r.district || r.area || '').toLowerCase();
          if (terr.indexOf(String(f.territory).toLowerCase()) < 0) return false;
        }
        return true;
      })
      .slice()
      .sort(function (a, b) {
        return String(b.creation || entryDate(b)).localeCompare(String(a.creation || entryDate(a)));
      });
  }

  function pct(n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 100);
  }

  function computeKpis(visits) {
    var total = visits.length;
    var purpose = 0;
    var outcome = 0;
    var status = 0;
    var lead = 0;
    var duration = 0;
    var gps = 0;
    var photo = 0;
    var notes = 0;
    var completionSum = 0;
    visits.forEach(function (r) {
      var c = visitCompletion(r);
      completionSum += c.pct;
      if (c.checks.purpose) purpose += 1;
      if (c.checks.outcome) outcome += 1;
      if (c.checks.visit_status) status += 1;
      if (c.checks.lead) lead += 1;
      if (c.checks.duration_minutes) duration += 1;
      if (c.checks.gps) gps += 1;
      if (c.checks.photo) photo += 1;
      if (c.checks.notes) notes += 1;
    });
    return {
      total: total,
      purpose: pct(purpose, total),
      outcome: pct(outcome, total),
      status: pct(status, total),
      lead: pct(lead, total),
      duration: pct(duration, total),
      gps: pct(gps, total),
      photo: pct(photo, total),
      notes: pct(notes, total),
      overall: total ? Math.round(completionSum / total) : 0,
      raw: { purpose: purpose, outcome: outcome, status: status, lead: lead, duration: duration, gps: gps, photo: photo, notes: notes },
    };
  }

  function employeeStats(visits) {
    var map = {};
    visits.forEach(function (r) {
      var key = r.sales_rep || r.full_name || 'unknown';
      if (!map[key]) {
        map[key] = {
          sales_rep: r.sales_rep || '',
          full_name: r.full_name || r.rep_code || 'Employee',
          rep_code: r.rep_code || '',
          visits: 0,
          completionSum: 0,
          durationSum: 0,
          durationCount: 0,
          positive: 0,
          outcomeCount: 0,
        };
      }
      var row = map[key];
      row.visits += 1;
      var c = visitCompletion(r);
      row.completionSum += c.pct;
      if (Number(r.duration_minutes) > 0) {
        row.durationSum += Number(r.duration_minutes);
        row.durationCount += 1;
      }
      if (hasVal(r.outcome)) {
        row.outcomeCount += 1;
        if (String(r.outcome).toLowerCase().indexOf('positive') >= 0) row.positive += 1;
      }
    });
    return Object.keys(map)
      .map(function (k) {
        var r = map[k];
        return {
          sales_rep: r.sales_rep,
          full_name: r.full_name,
          rep_code: r.rep_code,
          visits: r.visits,
          completion: r.visits ? Math.round(r.completionSum / r.visits) : 0,
          avg_duration: r.durationCount ? Math.round(r.durationSum / r.durationCount) : 0,
          positive_pct: r.outcomeCount ? Math.round((r.positive / r.outcomeCount) * 100) : 0,
        };
      })
      .sort(function (a, b) {
        return b.visits - a.visits;
      });
  }

  function renderKpis(k) {
    return (
      '<div class="rtp-kpi-row">' +
      '<div class="rtp-kpi c1"><span>Total Visits</span><b>' +
      esc(k.total) +
      '</b></div>' +
      '<div class="rtp-kpi c2"><span>Purpose Filled</span><b>' +
      esc(k.purpose) +
      '%</b></div>' +
      '<div class="rtp-kpi c3"><span>Outcome Filled</span><b>' +
      esc(k.outcome) +
      '%</b></div>' +
      '<div class="rtp-kpi c4"><span>Visit Status Auto</span><b>' +
      esc(k.status) +
      '%</b></div>' +
      '<div class="rtp-kpi c5"><span>Linked Lead</span><b>' +
      esc(k.lead) +
      '%</b></div>' +
      '<div class="rtp-kpi c6"><span>Duration Filled</span><b>' +
      esc(k.duration) +
      '%</b></div>' +
      '<div class="rtp-kpi c7"><span>GPS Captured</span><b>' +
      esc(k.gps) +
      '%</b></div>' +
      '<div class="rtp-kpi c8"><span>Visit Photo</span><b>' +
      esc(k.photo) +
      '%</b></div>' +
      '</div>'
    );
  }

  function renderFilters() {
    var employees = (st.activity.by_employee || []).slice();
    if (!employees.length) {
      var seen = {};
      allVisits().forEach(function (r) {
        if (!r.sales_rep || seen[r.sales_rep]) return;
        seen[r.sales_rep] = 1;
        employees.push({ sales_rep: r.sales_rep, full_name: r.full_name || r.rep_code || r.sales_rep });
      });
    }
    var purposes = uniqueOptions(function (r) {
      return r.purpose;
    });
    var statuses = uniqueOptions(function (r) {
      return r.visit_status;
    });
    var territories = uniqueOptions(function (r) {
      return r.territory || r.city || r.district || r.area;
    });
    return (
      '<div class="rtp-filters">' +
      '<label>Date From<input type="date" data-rtp-from value="' +
      esc(st.dateFrom) +
      '"></label>' +
      '<label>Date To<input type="date" data-rtp-to value="' +
      esc(st.dateTo) +
      '"></label>' +
      '<label>Employee<select data-rtp-filter="employee"><option value="">All Employees</option>' +
      employees
        .map(function (e) {
          var val = e.sales_rep || e.full_name || '';
          return (
            '<option value="' +
            esc(val) +
            '"' +
            (st.filters.employee === val ? ' selected' : '') +
            '>' +
            esc(e.full_name || e.rep_code || val) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<label>Territory / Zone<select data-rtp-filter="territory"><option value="">All Territories</option>' +
      territories
        .map(function (t) {
          return (
            '<option value="' +
            esc(t) +
            '"' +
            (st.filters.territory === t ? ' selected' : '') +
            '>' +
            esc(t) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<label>Visit Status<select data-rtp-filter="visitStatus"><option value="">All</option>' +
      statuses
        .map(function (s) {
          return (
            '<option value="' +
            esc(s) +
            '"' +
            (st.filters.visitStatus === s ? ' selected' : '') +
            '>' +
            esc(s) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<label>Purpose<select data-rtp-filter="purpose"><option value="">All</option>' +
      purposes
        .map(function (p) {
          return (
            '<option value="' +
            esc(p) +
            '"' +
            (st.filters.purpose === p ? ' selected' : '') +
            '>' +
            esc(p) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<button type="button" class="rtp-btn" data-rtp-apply>Apply Filter</button>' +
      '<button type="button" class="rtp-btn secondary" data-rtp-reset>Reset</button>' +
      '</div>'
    );
  }

  function renderVisitRows(pageRows, startIdx) {
    if (!pageRows.length) {
      return '<tr><td colspan="13"><div class="rtp-empty">No visits match the selected filters.</div></td></tr>';
    }
    return pageRows
      .map(function (r, i) {
        var c = visitCompletion(r);
        var lat = r.latitude;
        var lng = r.longitude;
        var gpsOk = visitHasGps(r);
        var mapHref = gpsOk
          ? 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng)
          : '';
        var photo = photoUrl(r.photo);
        return (
          '<tr>' +
          '<td>' +
          esc(startIdx + i + 1) +
          '</td>' +
          '<td>' +
          esc(fmtDateTime(r)) +
          '</td>' +
          '<td><div class="rtp-emp"><div class="rtp-avatar">' +
          esc(initials(r.full_name)) +
          '</div><div><strong>' +
          esc(r.full_name || 'Employee') +
          '</strong><small>' +
          esc((r.rep_code ? 'REP · ' + r.rep_code : 'REP') + (r.city || r.district ? ' · ' + (r.city || r.district) : '')) +
          '</small></div></div></td>' +
          '<td>' +
          (hasVal(r.purpose)
            ? '<span class="rtp-tag ' + purposeClass(r.purpose) + '">' + esc(r.purpose) + '</span>'
            : '—') +
          '</td>' +
          '<td>' +
          (hasVal(r.outcome)
            ? '<span class="rtp-tag ' + outcomeClass(r.outcome) + '">' + esc(r.outcome) + '</span>'
            : '—') +
          '</td>' +
          '<td>' +
          (hasVal(r.visit_status)
            ? '<span class="rtp-tag ' + statusClass(r.visit_status) + '">' + esc(r.visit_status) + '</span>'
            : '—') +
          '</td>' +
          '<td>' +
          (hasVal(r.lead)
            ? '<a href="/sales/leads" style="color:#0b6b57;font-weight:700">' + esc(r.lead) + '</a>'
            : '—') +
          '</td>' +
          '<td>' +
          (Number(r.duration_minutes) > 0 ? esc(r.duration_minutes) + ' min' : '—') +
          '</td>' +
          '<td>' +
          (gpsOk
            ? esc(Number(lat).toFixed(4) + ', ' + Number(lng).toFixed(4)) +
              ' <a href="' +
              esc(mapHref) +
              '" target="_blank" rel="noopener" title="Open map">↗</a>'
            : '—') +
          '</td>' +
          '<td><div class="rtp-notes">' +
          esc(r.notes || '—') +
          '</div></td>' +
          '<td>' +
          (photo
            ? '<a href="' + esc(photo) + '" target="_blank" rel="noopener"><img class="rtp-photo" src="' + esc(photo) + '" alt="Visit photo"></a>'
            : '<div class="rtp-photo-empty">None</div>') +
          '</td>' +
          '<td><span class="rtp-tag ' +
          (c.pct >= 80 ? 'green' : c.pct >= 50 ? 'amber' : 'gray') +
          '">' +
          esc(c.pct) +
          '%</span></td>' +
          '<td><button type="button" class="rtp-btn secondary" data-rtp-emp-pack="' +
          esc(r.sales_rep || '') +
          '" data-rtp-emp-name="' +
          esc(r.full_name || r.rep_code || 'employee') +
          '" title="Download employee pack">⋮</button></td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function renderPager(total) {
    var pages = Math.max(1, Math.ceil(total / st.pageSize));
    if (st.page > pages) st.page = pages;
    var start = (st.page - 1) * st.pageSize;
    var end = Math.min(total, start + st.pageSize);
    var buttons = '';
    var maxShow = 7;
    var from = Math.max(1, st.page - 3);
    var to = Math.min(pages, from + maxShow - 1);
    from = Math.max(1, to - maxShow + 1);
    for (var p = from; p <= to; p += 1) {
      buttons +=
        '<button type="button" class="' +
        (p === st.page ? 'active' : '') +
        '" data-rtp-page="' +
        p +
        '">' +
        p +
        '</button>';
    }
    return (
      '<div class="rtp-footer">' +
      '<div>Showing ' +
      (total ? start + 1 : 0) +
      '-' +
      end +
      ' of ' +
      total +
      ' visits</div>' +
      '<div class="rtp-pager">' +
      buttons +
      '</div>' +
      '<label style="display:flex;gap:8px;align-items:center">Rows per page' +
      '<select data-rtp-pagesize>' +
      [5, 10, 25, 50]
        .map(function (n) {
          return '<option value="' + n + '"' + (st.pageSize === n ? ' selected' : '') + '>' + n + '</option>';
        })
        .join('') +
      '</select></label></div>'
    );
  }

  function renderCompletionCard(k) {
    var bars = [
      ['Purpose', k.purpose],
      ['Outcome', k.outcome],
      ['Visit Status', k.status],
      ['Linked Lead', k.lead],
      ['Duration', k.duration],
      ['GPS', k.gps],
      ['Notes', k.notes],
      ['Visit Photo', k.photo],
    ]
      .map(function (row) {
        return (
          '<div class="rtp-bar-row"><span>' +
          esc(row[0]) +
          '</span><div class="rtp-bar-track"><div class="rtp-bar-fill" style="width:' +
          esc(row[1]) +
          '%"></div></div><b>' +
          esc(row[1]) +
          '%</b></div>'
        );
      })
      .join('');
    return (
      '<div class="rtp-card"><h3>Data Completion (This Period)</h3><div class="rtp-completion">' +
      '<div class="rtp-donut" style="--pct:' +
      esc(k.overall) +
      '"><div><b>' +
      esc(k.overall) +
      '%</b><span>Overall<br>Completion</span></div></div>' +
      '<div class="rtp-bars">' +
      bars +
      '</div></div></div>'
    );
  }

  function renderEmployeeRank(stats) {
    var top = stats.slice(0, 5);
    var body = top.length
      ? top
          .map(function (r, i) {
            return (
              '<tr>' +
              '<td>' +
              esc(i + 1) +
              '</td>' +
              '<td><strong>' +
              esc(r.full_name) +
              '</strong><div style="color:#5f746f;font-size:11px">' +
              esc(r.rep_code || '') +
              '</div></td>' +
              '<td>' +
              esc(r.visits) +
              '</td>' +
              '<td><div class="rtp-progress"><div class="rtp-bar-track"><div class="rtp-bar-fill" style="width:' +
              esc(r.completion) +
              '%"></div></div><span>' +
              esc(r.completion) +
              '%</span></div></td>' +
              '<td>' +
              (r.avg_duration ? esc(r.avg_duration) + ' min' : '—') +
              '</td>' +
              '<td>' +
              esc(r.positive_pct) +
              '%</td>' +
              '<td><button type="button" class="rtp-btn secondary" data-rtp-emp-pack="' +
              esc(r.sales_rep || '') +
              '" data-rtp-emp-name="' +
              esc(r.full_name || 'employee') +
              '">ZIP</button></td>' +
              '</tr>'
            );
          })
          .join('')
      : '<tr><td colspan="7"><div class="rtp-empty">No employee visit data.</div></td></tr>';
    return (
      '<div class="rtp-card"><h3>Employee Performance (Top 5 by Visit Count)</h3>' +
      '<div class="rtp-table-wrap"><table class="rtp-table rtp-rank-table"><thead><tr>' +
      '<th>#</th><th>Employee</th><th>Total Visits</th><th>Data Completion</th><th>Avg. Duration</th><th>Positive Outcome %</th><th></th>' +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div></div>'
    );
  }

  function renderVisitsTab(visits, kpis, stats) {
    var start = (st.page - 1) * st.pageSize;
    var pageRows = visits.slice(start, start + st.pageSize);
    return (
      renderKpis(kpis) +
      renderFilters() +
      '<div class="rtp-table-card">' +
      '<div class="rtp-table-head"><h3>Visit Performance Log</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="rtp-btn secondary" data-rtp-csv-portal>Export all entries</button>' +
      '<button type="button" class="rtp-btn secondary" data-rtp-csv-employees>Export by employee</button>' +
      '</div></div>' +
      '<div class="rtp-table-wrap"><table class="rtp-table"><thead><tr>' +
      '<th>#</th><th>Date &amp; Time</th><th>Employee</th><th>Purpose</th><th>Outcome</th><th>Visit Status</th>' +
      '<th>Linked Lead</th><th>Duration</th><th>GPS (Lat, Long)</th><th>Notes</th><th>Visit Photo</th><th>Data Status</th><th></th>' +
      '</tr></thead><tbody>' +
      renderVisitRows(pageRows, start) +
      '</tbody></table></div>' +
      renderPager(visits.length) +
      '</div>' +
      '<div class="rtp-bottom">' +
      renderCompletionCard(kpis) +
      renderEmployeeRank(stats) +
      '</div>'
    );
  }

  function renderEmployeesTab(stats) {
    var body = stats.length
      ? stats
          .map(function (r, i) {
            return (
              '<tr>' +
              '<td>' +
              esc(i + 1) +
              '</td>' +
              '<td><div class="rtp-emp"><div class="rtp-avatar">' +
              esc(initials(r.full_name)) +
              '</div><div><strong>' +
              esc(r.full_name) +
              '</strong><small>' +
              esc(r.rep_code || '') +
              '</small></div></div></td>' +
              '<td>' +
              esc(r.visits) +
              '</td>' +
              '<td><div class="rtp-progress"><div class="rtp-bar-track"><div class="rtp-bar-fill" style="width:' +
              esc(r.completion) +
              '%"></div></div><span>' +
              esc(r.completion) +
              '%</span></div></td>' +
              '<td>' +
              (r.avg_duration ? esc(r.avg_duration) + ' min' : '—') +
              '</td>' +
              '<td>' +
              esc(r.positive_pct) +
              '%</td>' +
              '<td><button type="button" class="rtp-btn" data-rtp-emp-pack="' +
              esc(r.sales_rep || '') +
              '" data-rtp-emp-name="' +
              esc(r.full_name || 'employee') +
              '">Download ZIP</button></td>' +
              '</tr>'
            );
          })
          .join('')
      : '<tr><td colspan="7"><div class="rtp-empty">No employees with visits in this range.</div></td></tr>';
    var byEmp = st.activity.by_employee || [];
    var leadRows = byEmp
      .map(function (r) {
        return (
          '<tr><td>' +
          esc(r.full_name || '') +
          '</td><td>' +
          esc(r.leads_count || 0) +
          '</td><td>' +
          esc(r.visits_count || 0) +
          '</td><td>' +
          esc(r.onboardings_count || 0) +
          '</td><td>' +
          esc(r.days_active || 0) +
          '</td><td>' +
          esc(r.total || 0) +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="rtp-table-card"><div class="rtp-table-head"><h3>Employee Performance</h3>' +
      '<button type="button" class="rtp-btn secondary" data-rtp-csv-employees>Export summary CSV</button></div>' +
      '<div class="rtp-table-wrap"><table class="rtp-table"><thead><tr>' +
      '<th>#</th><th>Employee</th><th>Total Visits</th><th>Data Completion</th><th>Avg. Duration</th><th>Positive Outcome %</th><th>Download</th>' +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div></div>' +
      (byEmp.length
        ? '<div class="rtp-card" style="margin-top:14px"><h3>Portal uploads by employee</h3><div class="rtp-table-wrap"><table class="rtp-table"><thead><tr><th>Employee</th><th>Leads</th><th>Visits</th><th>Onboard</th><th>Active days</th><th>Total</th></tr></thead><tbody>' +
          leadRows +
          '</tbody></table></div></div>'
        : '')
    );
  }

  function renderDataCompletionTab(kpis) {
    return renderKpis(kpis) + '<div class="rtp-bottom" style="grid-template-columns:1fr">' + renderCompletionCard(kpis) + '</div>';
  }

  function renderGpsTab(visits) {
    var withGps = visits.filter(visitHasGps);
    var missing = visits.filter(function (r) {
      return !visitHasGps(r);
    });
    var rows = (missing.length ? missing : withGps).slice(0, 50);
    var body = rows
      .map(function (r, i) {
        return (
          '<tr><td>' +
          esc(i + 1) +
          '</td><td>' +
          esc(fmtDateTime(r)) +
          '</td><td>' +
          esc(r.full_name || '') +
          '</td><td>' +
          (visitHasGps(r)
            ? esc(Number(r.latitude).toFixed(5) + ', ' + Number(r.longitude).toFixed(5))
            : '<span class="rtp-tag amber">Missing GPS</span>') +
          '</td><td>' +
          esc(r.purpose || '—') +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="rtp-kpi-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="rtp-kpi c1"><span>Total Visits</span><b>' +
      esc(visits.length) +
      '</b></div>' +
      '<div class="rtp-kpi c7"><span>GPS Captured</span><b>' +
      esc(pct(withGps.length, visits.length)) +
      '%</b><small>' +
      esc(withGps.length) +
      ' visits</small></div>' +
      '<div class="rtp-kpi c8"><span>Missing GPS</span><b>' +
      esc(missing.length) +
      '</b></div></div>' +
      '<div class="rtp-table-card"><div class="rtp-table-head"><h3>' +
      (missing.length ? 'Visits missing GPS' : 'GPS-captured visits') +
      '</h3></div><div class="rtp-table-wrap"><table class="rtp-table"><thead><tr><th>#</th><th>Date</th><th>Employee</th><th>Coordinates</th><th>Purpose</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5"><div class="rtp-empty">No visit rows.</div></td></tr>') +
      '</tbody></table></div></div>'
    );
  }

  function renderPhotoTab(visits) {
    var withPhoto = visits.filter(function (r) {
      return hasVal(r.photo);
    });
    var missing = visits.filter(function (r) {
      return !hasVal(r.photo);
    });
    var gallery = withPhoto
      .slice(0, 24)
      .map(function (r) {
        var url = photoUrl(r.photo);
        return (
          '<a href="' +
          esc(url) +
          '" target="_blank" rel="noopener" style="display:block;border:1px solid #d7e4df;border-radius:12px;overflow:hidden;background:#fff">' +
          '<img src="' +
          esc(url) +
          '" alt="" style="width:100%;height:120px;object-fit:cover;display:block">' +
          '<div style="padding:8px 10px;font-size:12px"><strong>' +
          esc(r.full_name || '') +
          '</strong><div style="color:#5f746f">' +
          esc(fmtDayLabel(entryDate(r))) +
          '</div></div></a>'
        );
      })
      .join('');
    return (
      '<div class="rtp-kpi-row" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="rtp-kpi c1"><span>Total Visits</span><b>' +
      esc(visits.length) +
      '</b></div>' +
      '<div class="rtp-kpi c5"><span>Photo Captured</span><b>' +
      esc(pct(withPhoto.length, visits.length)) +
      '%</b><small>' +
      esc(withPhoto.length) +
      ' with photo</small></div>' +
      '<div class="rtp-kpi c8"><span>Missing Photo</span><b>' +
      esc(missing.length) +
      '</b></div></div>' +
      '<div class="rtp-card"><h3>Visit photos</h3>' +
      (gallery
        ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">' + gallery + '</div>'
        : '<div class="rtp-empty">No visit photos in this period.</div>') +
      '</div>'
    );
  }

  function renderSummaryTab(visits, kpis, stats) {
    var c = (st.activity && st.activity.counts) || {};
    return (
      renderKpis(kpis) +
      '<div class="rtp-bottom">' +
      renderCompletionCard(kpis) +
      renderEmployeeRank(stats) +
      '</div>' +
      '<div class="rtp-card" style="margin-top:14px"><h3>Period summary</h3>' +
      '<div class="rtp-kpi-row" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:0">' +
      '<div class="rtp-kpi c1"><span>Leads uploaded</span><b>' +
      esc(c.leads || 0) +
      '</b></div>' +
      '<div class="rtp-kpi c2"><span>Visits logged</span><b>' +
      esc(c.visits || visits.length) +
      '</b></div>' +
      '<div class="rtp-kpi c3"><span>Onboardings</span><b>' +
      esc(c.onboardings || 0) +
      '</b></div>' +
      '<div class="rtp-kpi c4"><span>Active employees</span><b>' +
      esc(c.employees || stats.length) +
      '</b></div></div>' +
      '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="rtp-btn" data-rtp-csv-portal>Download all entries CSV</button>' +
      '<button type="button" class="rtp-btn secondary" data-rtp-csv-employees>Download by-employee CSV</button>' +
      '<button type="button" class="rtp-btn secondary" data-rtp-csv>Download notes CSV</button>' +
      '</div></div>' +
      renderNotesBlock()
    );
  }

  function renderNotesBlock() {
    if (!st.reports.length) {
      return '<div class="rtp-card" style="margin-top:14px"><h3>Daily notes</h3><div class="rtp-empty">No written daily notes in this range.</div></div>';
    }
    var rows = st.reports
      .map(function (r) {
        var files = (r.attachments || [])
          .map(function (f) {
            return (
              '<li><button type="button" class="rtp-btn link" data-rtp-file="' +
              esc(r.name) +
              '" data-rtp-fid="' +
              esc(f.name || '') +
              '">' +
              esc(f.file_name || 'Download') +
              '</button></li>'
            );
          })
          .join('');
        return (
          '<tr><td>' +
          esc(r.activity_date) +
          '</td>' +
          (st.isManager
            ? '<td><strong>' +
              esc(r.full_name || r.rep_code || '') +
              '</strong><div style="color:#5f746f;font-size:11px">' +
              esc(r.rep_code || '') +
              '</div></td>'
            : '') +
          '<td>' +
          esc(r.title || '') +
          '</td><td>' +
          esc(r.visits_done || 0) +
          '</td><td style="max-width:280px;white-space:pre-wrap">' +
          esc(r.activity_summary || '') +
          '</td><td>' +
          (files ? '<ul style="margin:0;padding-left:16px">' + files + '</ul>' : '—') +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="rtp-card" style="margin-top:14px"><h3>Daily notes</h3><div class="rtp-table-wrap"><table class="rtp-table"><thead><tr><th>Date</th>' +
      (st.isManager ? '<th>Employee</th>' : '') +
      '<th>Title</th><th>Visits</th><th>Summary</th><th>Files</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div></div>'
    );
  }

  function renderForm() {
    var f = st.form;
    var fileList = st.files
      .map(function (file, i) {
        return (
          '<li>' +
          esc(file.filename) +
          ' <button type="button" class="rtp-btn link" data-rtp-rm="' +
          i +
          '">Remove</button></li>'
        );
      })
      .join('');
    return (
      '<form class="rtp-form" data-rtp-form>' +
      '<h3>Submit daily activity note</h3>' +
      '<p style="margin:0 0 12px;color:#5f746f;font-size:13px">Optional written note on top of portal uploads. Counts prefill from today\'s activity.</p>' +
      '<div class="rtp-form-grid">' +
      '<label>Activity date<input type="date" name="activity_date" value="' +
      esc(f.activity_date) +
      '" required></label>' +
      '<label>Title<input name="title" value="' +
      esc(f.title) +
      '" maxlength="140" required></label>' +
      '<label>Doctors met<input type="number" min="0" name="doctors_met" value="' +
      esc(f.doctors_met) +
      '"></label>' +
      '<label>Visits done<input type="number" min="0" name="visits_done" value="' +
      esc(f.visits_done) +
      '"></label>' +
      '<label>Leads / samples<input type="number" min="0" name="samples_collected" value="' +
      esc(f.samples_collected) +
      '"></label>' +
      '<label>KM traveled<input type="number" min="0" step="0.1" name="km_traveled" value="' +
      esc(f.km_traveled) +
      '"></label>' +
      '<label>Area / location<input name="location_note" maxlength="140" placeholder="District, beat, or city" value="' +
      esc(f.location_note) +
      '"></label>' +
      '<textarea name="activity_summary" required placeholder="What did you cover today?">' +
      esc(f.activity_summary) +
      '</textarea>' +
      '</div>' +
      '<label style="margin-top:12px;display:flex;flex-direction:column;gap:6px;font:600 11px/1.2 \'DM Sans\',sans-serif;color:#5f746f">Upload activity files<input type="file" data-rtp-files multiple accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx,.csv"></label>' +
      (fileList ? '<ul style="margin:8px 0 0;padding-left:18px">' + fileList + '</ul>' : '') +
      '<div style="margin-top:12px"><button class="rtp-btn" type="submit"' +
      (st.busy ? ' disabled' : '') +
      '>' +
      (st.busy ? 'Submitting…' : 'Submit daily activity') +
      '</button></div></form>'
    );
  }

  function render() {
    var panel = document.querySelector('[' + PANEL_ATTR + ']');
    if (!panel) return;
    var visits = filteredVisits();
    var kpis = computeKpis(visits);
    var stats = employeeStats(visits);
    var tabs = [
      ['visits', 'Visit Performance'],
      ['employees', 'Employee Performance'],
      ['completion', 'Data Completion'],
      ['gps', 'GPS Compliance'],
      ['photo', 'Photo Compliance'],
      ['summary', 'Summary Report'],
    ];
    var tabHtml = tabs
      .map(function (t) {
        return (
          '<button type="button" class="rtp-tab' +
          (st.tab === t[0] ? ' active' : '') +
          '" data-rtp-tab="' +
          t[0] +
          '">' +
          esc(t[1]) +
          '</button>'
        );
      })
      .join('');
    var body = '';
    if (st.tab === 'employees') body = renderEmployeesTab(stats);
    else if (st.tab === 'completion') body = renderDataCompletionTab(kpis);
    else if (st.tab === 'gps') body = renderGpsTab(visits);
    else if (st.tab === 'photo') body = renderPhotoTab(visits);
    else if (st.tab === 'summary') body = renderSummaryTab(visits, kpis, stats);
    else body = renderVisitsTab(visits, kpis, stats);

    panel.innerHTML =
      '<div class="rtp-shell">' +
      '<div class="rtp-topbar">' +
      '<div class="rtp-brand"><h2>Field Marketing Performance Check</h2>' +
      '<p>Verify field visit activity, data completeness and team performance based on DCR/Sales Visit logs.</p></div>' +
      '<div class="rtp-top-actions">' +
      '<button type="button" class="rtp-btn secondary" data-rtp-csv-portal>Export CSV</button>' +
      '<button type="button" class="rtp-btn secondary" data-rtp-preset="30">Last 30 days</button>' +
      '</div></div>' +
      '<div class="rtp-tabs">' +
      tabHtml +
      '</div>' +
      (st.message
        ? '<div class="rtp-msg ' + (st.tone === 'error' ? 'err' : 'ok') + '">' + esc(st.message) + '</div>'
        : '') +
      body +
      renderForm() +
      '</div>';
  }

  function removePanels() {
    Array.prototype.slice
      .call(document.querySelectorAll('[' + PANEL_ATTR + '], #' + ROOT_ID + '[data-rtp-owned], .rtp-panel[data-rtp-owned]'))
      .forEach(function (el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
  }

  function ensurePanel() {
    // Field Marketing Performance Check is Team map only.
    if (!onSalesMap()) {
      removePanels();
      return null;
    }
    var existing = document.querySelector('[' + PANEL_ATTR + ']');
    if (existing) return existing;
    var native = document.getElementById(ROOT_ID);
    var panel;
    if (native) {
      // Take over SPA placeholder so dashboard ships without a full rebuild.
      panel = native;
      panel.className = 'rtp-panel';
      panel.setAttribute(PANEL_ATTR, '1');
      panel.setAttribute('data-rtp-owned', '1');
      panel.innerHTML = '';
    } else {
      var main = mountPoint();
      if (!main) return null;
      panel = document.createElement('section');
      panel.className = 'rtp-panel';
      panel.id = ROOT_ID;
      panel.setAttribute(PANEL_ATTR, '1');
      panel.setAttribute('data-rtp-owned', '1');
      main.appendChild(panel);
    }
    loadAll();
    render();
    return panel;
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.matches && t.matches('[data-rtp-from]')) st.dateFrom = t.value || '';
    if (t.matches && t.matches('[data-rtp-to]')) st.dateTo = t.value || '';
    if (t.matches && t.matches('[data-rtp-filter]')) {
      var key = t.getAttribute('data-rtp-filter');
      if (key) {
        st.filters[key] = t.value || '';
        st.page = 1;
        render();
      }
    }
    if (t.matches && t.matches('[data-rtp-pagesize]')) {
      st.pageSize = Number(t.value) || 10;
      st.page = 1;
      render();
    }
    if (t.matches && t.matches('[data-rtp-files]')) {
      var picked = Array.prototype.slice.call(t.files || [], 0, 5);
      t.value = '';
      Promise.all(
        picked.map(function (file) {
          if (!/\.(pdf|jpe?g|png|xlsx?|docx?|csv)$/i.test(file.name)) {
            throw new Error('Allowed uploads: PDF, JPG, PNG, Excel, Word, CSV');
          }
          if (file.size > 8 * 1024 * 1024) throw new Error(file.name + ' exceeds 8MB limit');
          return fileToBase64(file).then(function (b64) {
            return { filename: file.name, file_content: b64 };
          });
        }),
      )
        .then(function (rows) {
          st.files = (st.files || []).concat(rows).slice(0, 10);
          render();
        })
        .catch(function (err) {
          setMsg(err.message || 'File upload failed', 'error');
        });
    }
    if (t.form && t.form.matches && t.form.matches('[data-rtp-form]') && t.name) {
      st.form[t.name] = t.value;
    }
  });

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var tab = t.closest('[data-rtp-tab]');
    if (tab) {
      st.tab = tab.getAttribute('data-rtp-tab') || 'visits';
      st.page = 1;
      render();
      return;
    }
    var pageBtn = t.closest('[data-rtp-page]');
    if (pageBtn) {
      st.page = Number(pageBtn.getAttribute('data-rtp-page') || 1);
      render();
      return;
    }
    if (t.closest('[data-rtp-apply]')) {
      st.page = 1;
      st.datesApplied = true;
      loadAll(true);
      return;
    }
    if (t.closest('[data-rtp-reset]')) {
      st.filters = { employee: '', territory: '', visitStatus: '', purpose: '' };
      st.datesApplied = false;
      st.dateFrom = '';
      st.dateTo = '';
      st.page = 1;
      loadAll(false);
      return;
    }
    var preset = t.closest('[data-rtp-preset]');
    if (preset) {
      var n = Number(preset.getAttribute('data-rtp-preset') || 30);
      // Use server range on preset by clearing client dates first, then requesting N days via server default
      st.datesApplied = false;
      st.dateFrom = '';
      st.dateTo = '';
      st.page = 1;
      call('get_sales_team_portal_activity', { limit: 5000 })
        .then(function (activity) {
          st.activity = activity || st.activity;
          if (activity && activity.date_to) {
            st.dateTo = activity.date_to;
            // Walk back N days from server end date
            try {
              var end = new Date(activity.date_to + 'T12:00:00');
              end.setDate(end.getDate() - (Math.max(n, 1) - 1));
              st.dateFrom = end.toISOString().slice(0, 10);
              st.datesApplied = true;
            } catch (e) {}
          }
          return loadAll(true);
        })
        .catch(function () {
          loadAll(false);
        });
      return;
    }
    var rm = t.closest('[data-rtp-rm]');
    if (rm) {
      st.files.splice(Number(rm.getAttribute('data-rtp-rm')), 1);
      render();
      return;
    }
    if (t.closest('[data-rtp-csv-portal]')) {
      setMsg('Preparing full entries CSV for selected range…', 'ok');
      call('download_sales_team_portal_activity_csv', rangeBody())
        .then(function (data) {
          downloadText(data.filename || 'team-portal-activity.csv', data.csv || '', 'text/csv;charset=utf-8');
          setMsg(
            'Downloaded ' +
              (data.count || 0) +
              ' individual entries for ' +
              (data.date_from || st.dateFrom) +
              ' to ' +
              (data.date_to || st.dateTo),
            'ok',
          );
        })
        .catch(function (err) {
          var local = buildPortalCsvFromState();
          if (local.count > 0) {
            downloadText(local.filename, local.csv, 'text/csv;charset=utf-8');
            setMsg(
              'Server export failed; downloaded ' + local.count + ' loaded entries. ' + (err.message || ''),
              'error',
            );
            return;
          }
          setMsg(err.message || 'Portal CSV download failed', 'error');
        });
      return;
    }
    if (t.closest('[data-rtp-csv-employees]')) {
      var empCsv = buildEmployeeSummaryCsv();
      downloadText(empCsv.filename, empCsv.csv, 'text/csv;charset=utf-8');
      setMsg('Downloaded ' + empCsv.count + ' employee summary row(s)', 'ok');
      return;
    }
    var empPack = t.closest('[data-rtp-emp-pack]');
    if (empPack) {
      downloadEmployeePack(empPack.getAttribute('data-rtp-emp-pack') || '', empPack.getAttribute('data-rtp-emp-name') || '');
      return;
    }
    if (t.closest('[data-rtp-csv]')) {
      call('download_sales_team_performance_csv', rangeBody())
        .then(function (data) {
          downloadText(data.filename || 'team-performance.csv', data.csv || '', 'text/csv;charset=utf-8');
          setMsg('Downloaded ' + (data.count || 0) + ' note(s)', 'ok');
        })
        .catch(function (err) {
          setMsg(err.message || 'CSV download failed', 'error');
        });
      return;
    }
    var fileBtn = t.closest('[data-rtp-file]');
    if (fileBtn) {
      call('download_sales_team_performance_file', {
        report_name: fileBtn.getAttribute('data-rtp-file'),
        file_name: fileBtn.getAttribute('data-rtp-fid') || '',
      })
        .then(function (data) {
          downloadBase64(data.file_name || 'attachment', data.file_content);
        })
        .catch(function (err) {
          setMsg(err.message || 'Attachment download failed', 'error');
        });
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('[data-rtp-form]')) return;
    e.preventDefault();
    if (st.busy) return;
    var fd = new FormData(form);
    var summary = String(fd.get('activity_summary') || '').trim();
    if (!summary) {
      setMsg('Daily activity summary is required', 'error');
      return;
    }
    st.busy = true;
    render();
    call('submit_sales_team_performance_report', {
      activity_date: String(fd.get('activity_date') || todayIso()),
      title: String(fd.get('title') || 'Daily field activity').trim(),
      activity_summary: summary,
      doctors_met: String(fd.get('doctors_met') || 0),
      visits_done: String(fd.get('visits_done') || 0),
      samples_collected: String(fd.get('samples_collected') || 0),
      km_traveled: String(fd.get('km_traveled') || 0),
      location_note: String(fd.get('location_note') || '').trim(),
      attachments_json: JSON.stringify(st.files || []),
    })
      .then(function () {
        st.files = [];
        st.form.activity_summary = '';
        st.busy = false;
        st.tab = 'summary';
        setMsg('Daily activity submitted', 'ok');
        return loadAll();
      })
      .catch(function (err) {
        st.busy = false;
        setMsg(err.message || 'Submit failed', 'error');
      });
  });

  setInterval(ensurePanel, 1200);
  ensurePanel();
})();

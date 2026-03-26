'use strict';
const API = window.location.origin;
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ─── Team maps (same as app.js) ───────────────────────────────────────────
const TD = {
  'Royal Challengers Bengaluru':'d-rcb','Mumbai Indians':'d-mi','Delhi Capitals':'d-dc',
  'Chennai Super Kings':'d-csk','Sunrisers Hyderabad':'d-srh','Punjab Kings':'d-pbks',
  'Rajasthan Royals':'d-rr','Gujarat Titans':'d-gt','Kolkata Knight Riders':'d-kkr',
  'Lucknow Super Giants':'d-lsg'
};
const TI = {
  'Royal Challengers Bengaluru':'RCB','Mumbai Indians':'MI','Delhi Capitals':'DC',
  'Chennai Super Kings':'CSK','Sunrisers Hyderabad':'SRH','Punjab Kings':'PBKS',
  'Rajasthan Royals':'RR','Gujarat Titans':'GT','Kolkata Knight Riders':'KKR',
  'Lucknow Super Giants':'LSG'
};

// ─── Fixtures (loaded via fixtures.js global) ─────────────────────────────
const _FX = (typeof FIXTURES !== 'undefined' ? FIXTURES : []);
const MATCHES = _FX.map(f => ({
  id: f.id, date: f.label, fullDate: f.date,
  t1: f.t1, t2: f.t2,
  c1: TD[f.t1]||'', c2: TD[f.t2]||''
}));

function groupByWeek(matches) {
  const getMonday = d => {
    const dt = new Date(d + 'T00:00:00');
    const diff = (dt.getDay() === 0 ? -6 : 1 - dt.getDay());
    const mon = new Date(dt); mon.setDate(dt.getDate() + diff);
    return mon;
  };
  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const map = new Map();
  matches.forEach(m => {
    const mon = getMonday(m.fullDate);
    const key = mon.toISOString().slice(0,10);
    if (!map.has(key)) map.set(key, { monday: mon, matches: [] });
    map.get(key).matches.push(m);
  });
  let wn = 1;
  const weeks = [];
  for (const [, val] of map) {
    const sun = new Date(val.monday); sun.setDate(sun.getDate() + 6);
    weeks.push({ weekLabel: `WEEK ${wn}`, dateRange: `${fmt(val.monday)} – ${fmt(sun)}`, matches: val.matches });
    wn++;
  }
  return weeks;
}
const WEEKS = groupByWeek(MATCHES);

// ─── State ────────────────────────────────────────────────────────────────
const S = { groupId: null, group: null, results: {}, myNames: [] };

// ─── Init ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const gid = params.get('group')?.toUpperCase();
  if (gid) {
    document.getElementById('gc-input').value = gid;
    loadGroup(gid);
  }
});

function viewGroup() {
  const gid = document.getElementById('gc-input').value.trim().toUpperCase();
  if (!gid) return;
  history.replaceState(null, '', `?group=${gid}`);
  loadGroup(gid);
}

async function loadGroup(gid) {
  show('bc-loading'); hide('bc-content'); hide('bc-locked-msg'); hide('bc-error');

  try {
    const [grpRes, resRes] = await Promise.all([
      fetch(`${API}/api/group/${gid}`),
      fetch(`${API}/api/results`)
    ]);
    if (!grpRes.ok) throw new Error('Group not found');
    const group = await grpRes.json();
    const results = await resRes.json();

    S.groupId = gid;
    S.group = group;
    S.results = results;

    // Detect "me" from localStorage (match group)
    try {
      const brackets = JSON.parse(localStorage.getItem('ipl_brackets') || '[]');
      S.myNames = brackets
        .filter(b => b.groupId === gid)
        .map(b => b.picks?.name?.trim().toLowerCase())
        .filter(Boolean);
    } catch { S.myNames = []; }

    hide('bc-loading');

    if (!group.locked) { show('bc-locked-msg'); return; }

    render();
    show('bc-content');
  } catch (e) {
    hide('bc-loading');
    document.getElementById('bc-error-msg').textContent = e.message;
    show('bc-error');
  }
}

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

// ─── Render ───────────────────────────────────────────────────────────────
function render() {
  renderGroupStrip();
  renderMatrix();
  renderPlayoffs();
}

function renderGroupStrip() {
  const g = S.group;
  document.getElementById('bc-group-name').textContent = g.name || g.id;
  document.getElementById('bc-group-code').textContent = g.id;
  document.getElementById('bc-members').textContent = g.memberCount || (g.leaderboard||[]).length;
  document.getElementById('bc-results-in').textContent = Object.keys(S.results.matches || {}).length;
  const last = S.results.lastSynced ? ago(new Date(S.results.lastSynced)) : '—';
  document.getElementById('bc-last-sync').textContent = last;
}

function ago(d) {
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

// Players in leaderboard order
function getPlayers() {
  return (S.group.leaderboard || []).map(e => ({
    ...e,
    isMe: S.myNames.includes((e.name || '').trim().toLowerCase())
  }));
}

function playerHeaderHTML(p) {
  const champAbbr = p.champion ? (TI[p.champion] || p.champion) : '';
  let champCls = 'bc-champ-pending';
  if (S.results.champion) {
    champCls = p.champion === S.results.champion ? 'bc-champ-correct' : 'bc-champ-wrong';
  }
  return `<th class="bc-player-hd${p.isMe ? ' bc-me' : ''}">
    <div class="bc-rank-badge">${p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : '#' + p.rank}</div>
    <div class="bc-player-name" title="${esc(p.name)}">${esc(p.name)}</div>
    <div class="bc-player-pts">${p.pts}pts</div>
    ${champAbbr ? `<div class="bc-player-champ ${champCls}"><span class="dot ${TD[p.champion]||''}"></span>${champAbbr}</div>` : ''}
  </th>`;
}

// ─── League match matrix ──────────────────────────────────────────────────
function renderMatrix() {
  const players = getPlayers();
  const totalCols = players.length + 1;

  let html = `<div class="bc-outer"><div class="bc-scroll-hint-mob">swipe right to see all players →</div><div class="bc-wrap"><table class="bc-table"><thead><tr>
    <th class="bc-match-hd"><div class="bc-match-hd-inner">Match</div></th>
    ${players.map(playerHeaderHTML).join('')}
  </tr></thead><tbody>`;

  WEEKS.forEach(wk => {
    html += `<tr class="bc-week-row">
      <td colspan="${totalCols}">${wk.weekLabel}<em class="bc-week-dates-label">${wk.dateRange}</em></td>
    </tr>`;

    wk.matches.forEach(m => {
      const result = S.results.matches?.[m.id];
      html += `<tr>
        <td class="bc-match-info">
          <div class="bc-mid">M${m.id} · ${m.date}</div>
          <div class="bc-mteams"><span class="dot ${m.c1}"></span>${TI[m.t1]||m.t1}<span class="bc-vs">v</span><span class="dot ${m.c2}"></span>${TI[m.t2]||m.t2}</div>
          ${result ? `<div class="bc-mresult">→ ${TI[result]||result}</div>` : ''}
        </td>
        ${players.map(p => {
          const mp = (p.matchPicks || []).find(x => x.matchId === m.id);
          if (!mp) return `<td class="bc-cell bc-empty${p.isMe?' bc-me-cell':''}">—</td>`;
          const cls = mp.status === 'correct' ? 'bc-correct' : mp.status === 'incorrect' ? 'bc-wrong' : 'bc-pending';
          return `<td class="bc-cell ${cls}${p.isMe?' bc-me-cell':''}"><span class="dot ${TD[mp.pick]||''}"></span> ${TI[mp.pick]||mp.pick}</td>`;
        }).join('')}
      </tr>`;
    });
  });

  html += `</tbody></table></div></div>`;
  document.getElementById('bc-matrix').innerHTML = html;
  bindScrollFade(document.querySelector('#bc-matrix .bc-wrap'));
}

// ─── Playoff comparison ───────────────────────────────────────────────────
function renderPlayoffs() {
  const players = getPlayers();
  const totalCols = players.length + 1;
  const semisKnown = !!(S.results.semis?.length);
  const champKnown = !!S.results.champion;

  let html = `<div class="bc-outer"><div class="bc-scroll-hint-mob">swipe right to see all players →</div><div class="bc-wrap"><table class="bc-table"><thead><tr>
    <th class="bc-match-hd"><div class="bc-match-hd-inner">Playoff Picks</div></th>
    ${players.map(playerHeaderHTML).join('')}
  </tr></thead><tbody>`;

  // Semis section
  html += `<tr class="bc-week-row">
    <td colspan="${totalCols}">TOP 4 SEMIFINALISTS<em class="bc-week-dates-label">5 pts each</em></td>
  </tr>`;

  for (let i = 0; i < 4; i++) {
    const knownSemi = semisKnown && S.results.semis[i];
    html += `<tr>
      <td class="bc-match-info">
        <div class="bc-mid">SF Pick #${i+1}</div>
        ${knownSemi ? `<div class="bc-mresult">→ ${TI[knownSemi]||knownSemi}</div>` : ''}
      </td>
      ${players.map(p => {
        const pick = (p.semis || [])[i];
        if (!pick) return `<td class="bc-cell bc-empty${p.isMe?' bc-me-cell':''}">—</td>`;
        let cls = 'bc-pending';
        if (semisKnown) cls = S.results.semis.includes(pick) ? 'bc-correct' : 'bc-wrong';
        return `<td class="bc-cell ${cls}${p.isMe?' bc-me-cell':''}"><span class="dot ${TD[pick]||''}"></span> ${TI[pick]||pick}</td>`;
      }).join('')}
    </tr>`;
  }

  // Champion section
  html += `<tr class="bc-week-row">
    <td colspan="${totalCols}">CHAMPION<em class="bc-week-dates-label">10 pts</em></td>
  </tr>
  <tr>
    <td class="bc-match-info">
      <div class="bc-mid">🏆 Pick</div>
      ${champKnown ? `<div class="bc-mresult">→ ${TI[S.results.champion]||S.results.champion}</div>` : ''}
    </td>
    ${players.map(p => {
      const pick = p.champion;
      if (!pick) return `<td class="bc-cell bc-empty${p.isMe?' bc-me-cell':''}">—</td>`;
      let cls = 'bc-pending';
      if (champKnown) cls = pick === S.results.champion ? 'bc-correct' : 'bc-wrong';
      return `<td class="bc-cell ${cls}${p.isMe?' bc-me-cell':''}"><span class="dot ${TD[pick]||''}"></span> ${TI[pick]||pick}</td>`;
    }).join('')}
  </tr>`;

  html += `</tbody></table></div></div>`;
  document.getElementById('bc-playoffs').innerHTML = html;
  bindScrollFade(document.querySelector('#bc-playoffs .bc-wrap'));
}

// ─── Scroll fade ─────────────────────────────────────────────────────────
// Remove right-edge mask once the user has scrolled all the way right
function bindScrollFade(wrap) {
  if (!wrap) return;
  const check = () => {
    const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
    wrap.classList.toggle('at-end', atEnd);
  };
  wrap.addEventListener('scroll', check, { passive: true });
  check();
}

// ─── Share ────────────────────────────────────────────────────────────────
function copyLink() {
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = document.getElementById('bc-share-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

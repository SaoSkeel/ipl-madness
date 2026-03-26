'use strict';
const API = window.location.origin;
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ─── DATA FROM fixtures.js (loaded via <script src="fixtures.js">) ───────────
const _FX = (typeof FIXTURES !== 'undefined' ? FIXTURES : []);

const TD={
  'Royal Challengers Bengaluru':'d-rcb',
  'Mumbai Indians':'d-mi',
  'Delhi Capitals':'d-dc',
  'Chennai Super Kings':'d-csk',
  'Sunrisers Hyderabad':'d-srh',
  'Punjab Kings':'d-pbks',
  'Rajasthan Royals':'d-rr',
  'Gujarat Titans':'d-gt',
  'Kolkata Knight Riders':'d-kkr',
  'Lucknow Super Giants':'d-lsg'
};
const TI={
  'Royal Challengers Bengaluru':'RCB',
  'Mumbai Indians':'MI',
  'Delhi Capitals':'DC',
  'Chennai Super Kings':'CSK',
  'Sunrisers Hyderabad':'SRH',
  'Punjab Kings':'PBKS',
  'Rajasthan Royals':'RR',
  'Gujarat Titans':'GT',
  'Kolkata Knight Riders':'KKR',
  'Lucknow Super Giants':'LSG'
};

const MATCHES = _FX.map(f=>({
  id: f.id,
  date: f.label,         // MM/DD format for display
  fullDate: f.date,      // YYYY-MM-DD for week grouping
  t1: f.t1,
  t2: f.t2,
  venue: f.venue,
  c1: TD[f.t1]||'',
  c2: TD[f.t2]||''
}));

const TEAMS=['Royal Challengers Bengaluru','Mumbai Indians','Delhi Capitals','Chennai Super Kings','Sunrisers Hyderabad','Punjab Kings','Rajasthan Royals','Gujarat Titans','Kolkata Knight Riders','Lucknow Super Giants'];
const PTS={match:2,semi:5,winner:10};

// ─── WEEK GROUPING ────────────────────────────────────────────────────────────
// Returns array of { weekLabel, dateRange, matches[] }
function groupByWeek(matches) {
  const weeks = [];
  const getMonday = d => {
    const dt = new Date(d + 'T00:00:00');
    const day = dt.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    const mon = new Date(dt);
    mon.setDate(dt.getDate() + diff);
    return mon;
  };
  const fmt = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric'});

  const map = new Map();
  matches.forEach(m => {
    const mon = getMonday(m.fullDate);
    const key = mon.toISOString().slice(0,10);
    if(!map.has(key)) map.set(key, { monday: mon, matches: [] });
    map.get(key).matches.push(m);
  });

  let wn = 1;
  for(const [,val] of map) {
    const sun = new Date(val.monday); sun.setDate(sun.getDate() + 6);
    weeks.push({
      weekLabel: `WEEK ${wn}`,
      dateRange: `${fmt(val.monday)} – ${fmt(sun)}`,
      matches: val.matches
    });
    wn++;
  }
  return weeks;
}

const WEEKS = groupByWeek(MATCHES);

// ─── STATE ────────────────────────────────────────────────────────────────────
let S={
  brackets:[],
  activePickId:null,
  results:{},
  editMode:false,
  editGid:null,
};
let _viewingGroupId=null;

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const ls={
  get:k=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}catch{return null;}},
  set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
};

// ─── TABS ─────────────────────────────────────────────────────────────────────
function showTab(name,btn){
  document.querySelectorAll('.tab').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  if(btn)btn.classList.add('active');
  if(name==='my')renderMy();
  if(name==='group'){
    const ab=S.brackets.find(b=>b.pickId===S.activePickId)||S.brackets[0];
    if(ab&&!_viewingGroupId){_viewingGroupId=ab.groupId;}
    const gc=document.getElementById('gc-input');
    if(gc&&(_viewingGroupId||ab?.groupId))gc.value=_viewingGroupId||ab?.groupId||'';
    loadGroup();
  }
}
function goTab(name){showTab(name,document.querySelectorAll('.nb')[[,'my','group','enter'].indexOf(name)]);}

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded',async()=>{
  buildForm();
  S.brackets=ls.get('ipl_brackets')||[];
  S.activePickId=ls.get('ipl_activePickId');
  if(!S.activePickId){const oldGid=ls.get('ipl_activeGid');if(oldGid){const b=S.brackets.find(x=>x.groupId===oldGid);if(b)S.activePickId=b.pickId;}}
  if(!S.activePickId&&S.brackets.length) S.activePickId=S.brackets[0].pickId;
  const _initB=S.brackets.find(b=>b.pickId===S.activePickId)||S.brackets[0];
  if(_initB)_viewingGroupId=_initB.groupId;
  await loadResults();
  renderMy();
  if(_viewingGroupId)loadGroup();
  setInterval(async()=>{await loadResults();renderMy();if(document.getElementById('tab-group').classList.contains('active'))loadGroup();},5*60*1000);
});

// ─── RESULTS ──────────────────────────────────────────────────────────────────
async function loadResults(){
  try{
    const r=await fetch(`${API}/api/results`);
    S.results=await r.json();
    const dot=document.getElementById('sdot');
    const lbl=document.getElementById('slbl');
    dot.className='sync-dot live';
    lbl.textContent=S.results.lastSynced?'synced '+ago(new Date(S.results.lastSynced)):'synced';
  }catch{S.results=ls.get('ipl_results')||{};}
}

function ago(d){
  const s=Math.floor((Date.now()-d)/1000);
  if(s<60)return 'just now';
  if(s<3600)return Math.floor(s/60)+'m ago';
  return Math.floor(s/3600)+'h ago';
}

// ─── LOCAL SCORING ────────────────────────────────────────────────────────────
function score(picks,results){
  let pts=0;const r=results||{};const bd={league:[],semis:[],champion:null};
  for(const m of MATCHES){
    const pick=picks.matches?.[m.id];const res=r.matches?.[m.id];
    if(!pick)continue;
    if(!res)bd.league.push({matchId:m.id,pick,result:null,status:'pending',pts:0});
    else if(pick===res){pts+=PTS.match;bd.league.push({matchId:m.id,pick,result:res,status:'correct',pts:PTS.match});}
    else bd.league.push({matchId:m.id,pick,result:res,status:'incorrect',pts:0});
  }
  const sk=!!(r.semis&&r.semis.length);
  for(const t of(picks.semis||[])){
    if(!sk)bd.semis.push({team:t,status:'pending',pts:0});
    else if(r.semis.includes(t)){pts+=PTS.semi;bd.semis.push({team:t,status:'correct',pts:PTS.semi});}
    else bd.semis.push({team:t,status:'incorrect',pts:0});
  }
  if(!r.champion)bd.champion={team:picks.champion,status:'pending',pts:0};
  else if(picks.champion===r.champion){pts+=PTS.winner;bd.champion={team:picks.champion,status:'correct',pts:PTS.winner};}
  else bd.champion={team:picks.champion,status:'incorrect',pts:0};
  return{pts,breakdown:bd};
}

function maxPts(picks,results){
  const r=results||{};let max=0;
  for(const m of MATCHES){const res=r.matches?.[m.id];const pick=picks.matches?.[m.id];if(!res||pick===res)max+=PTS.match;}
  const sk=!!(r.semis&&r.semis.length);
  for(const t of(picks.semis||[])){if(!sk||r.semis.includes(t))max+=PTS.semi;}
  if(!r.champion||picks.champion===r.champion)max+=PTS.winner;
  return max;
}

// ─── MY BRACKET ───────────────────────────────────────────────────────────────
function renderMy(){
  const all=S.brackets;
  document.getElementById('no-picks').style.display=all.length?'none':'block';
  document.getElementById('my-content').style.display=all.length?'block':'none';
  if(!all.length)return;

  if(!S.activePickId||!all.find(b=>b.pickId===S.activePickId)) S.activePickId=all[0].pickId;

  const sw=document.getElementById('switcher-wrap');
  const pills=document.getElementById('switcher-pills');
  if(all.length>1){
    sw.style.display='block';pills.innerHTML='';
    all.forEach(b=>{
      const sc=score(b.picks,S.results);
      const p=document.createElement('button');
      p.className='bpill'+(b.pickId===S.activePickId?' active':'');
      p.innerHTML=`<span class="bpill-grp">${esc(b.groupId)}</span>${esc(b.picks.name)}<span class="bpill-pts">${sc.pts}pts</span>`;
      p.onclick=()=>{S.activePickId=b.pickId;ls.set('ipl_activePickId',b.pickId);renderMy();if(document.getElementById('tab-group').classList.contains('active'))loadGroup();};
      pills.appendChild(p);
    });
  }else sw.style.display='none';

  const active=all.find(b=>b.pickId===S.activePickId)||all[0];
  const picks=active.picks;
  const {pts,breakdown}=score(picks,S.results);
  const mx=maxPts(picks,S.results);
  const pct=mx>0?Math.round(pts/mx*100):0;

  document.getElementById('my-pts').textContent=pts;
  document.getElementById('my-max').textContent=mx;
  document.getElementById('my-bar').style.width=pct+'%';
  document.getElementById('my-group-label').textContent='Group '+active.groupId;
  document.getElementById('my-rank').textContent='—';

  const eb=document.getElementById('my-edit-btn');
  eb.style.display=active.locked?'none':'inline-flex';

  // Semis
  const sw2=document.getElementById('semi-summary');sw2.innerHTML='';
  (picks.semis||[]).forEach((t,i)=>{
    const bd=breakdown.semis[i]||{status:'pending'};
    sw2.innerHTML+=`<div class="pi"><div><div class="pi-sub">SF #${i+1}</div><div class="pi-name"><span class="dot ${TD[t]||''}"></span>${t}</div></div>
      <span class="chip ${bd.status==='correct'?'chip-green':bd.status==='incorrect'?'chip-red':'chip-gold'}">${bd.status==='correct'?'✓ 5':bd.status==='incorrect'?'✗':'5'}</span></div>`;
  });

  // Champion
  const cbd=breakdown.champion||{status:'pending'};
  document.getElementById('champ-name').innerHTML=`<span class="dot ${TD[picks.champion]||''}"></span> ${picks.champion||'—'}`;
  document.getElementById('champ-status').textContent=cbd.status==='correct'?'✓ 10 PTS':cbd.status==='incorrect'?'✗ 0':'10 PTS';
  document.getElementById('champ-status').className='chip '+(cbd.status==='correct'?'chip-green':cbd.status==='incorrect'?'chip-red':'chip-gold');

  // Render weekly accordion for match results
  renderMyWeeks(picks, breakdown);

  // Other brackets
  const others=all.filter(b=>b.pickId!==S.activePickId);
  const ow=document.getElementById('other-wrap');
  const ol=document.getElementById('other-list');
  if(others.length){
    ow.style.display='block';
    document.getElementById('other-count').textContent=`${others.length} MORE`;
    ol.innerHTML='';
    others.forEach(b=>{
      const sc=score(b.picks,S.results);
      const card=document.createElement('div');
      card.className='ob-card';
      card.innerHTML=`<div class="ob-hd" onclick="this.parentElement.classList.toggle('open')">
        <div><div style="display:flex;align-items:center;gap:8px;"><span class="ob-grp-tag">${esc(b.groupId)}</span><span style="font-weight:700;">${esc(b.picks.name)}</span></div>
          <div class="ob-meta">Submitted ${b.picks.submittedAt?new Date(b.picks.submittedAt).toLocaleDateString():''}</div></div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="text-align:right;"><div class="ob-pts-val">${sc.pts}</div><div class="ob-pts-max">max ${maxPts(b.picks,S.results)}</div></div>
          <span class="ob-chev">▾</span></div></div>
      <div class="ob-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:5px;margin-bottom:8px;">
          ${MATCHES.map(m=>{const pick=b.picks.matches?.[m.id];const res=S.results.matches?.[m.id];let st='pending';if(res)st=pick===res?'correct':'incorrect';
            return `<div style="background:var(--bg3);border-radius:6px;padding:6px 10px;display:flex;align-items:center;gap:5px;">
              <span style="font-size:9px;color:var(--muted);font-family:'Space Mono',monospace;min-width:24px;">M${m.id}</span>
              <span style="font-size:11px;font-weight:600;flex:1;"><span class="dot ${TD[pick]||''}"></span> ${esc(pick||'—')}</span>
              <span class="chip ${st==='correct'?'chip-green':st==='incorrect'?'chip-red':'chip-gold'}" style="font-size:9px;padding:2px 5px;">${st==='correct'?'+2':st==='incorrect'?'✗':'?'}</span></div>`;}).join('')}
        </div>
        <div class="ob-actions">
          <button class="bpill active js-view-btn">👁 View Active</button>
          ${!b.locked?`<button class="edit-btn js-edit-btn">✏️ Edit</button>`:`<div class="locked-note">🔒 Locked</div>`}
        </div>
      </div>`;
      card.querySelector('.js-view-btn').addEventListener('click',()=>{S.activePickId=b.pickId;ls.set('ipl_activePickId',b.pickId);renderMy();window.scrollTo({top:0,behavior:'smooth'});});
      card.querySelector('.js-edit-btn')?.addEventListener('click',()=>startEdit(b.groupId,b.picks.name));
      ol.appendChild(card);
    });
  }else ow.style.display='none';
}

function renderMyWeeks(picks, breakdown){
  const container = document.getElementById('my-weeks');
  container.innerHTML = '';

  WEEKS.forEach((wk, wi) => {
    const wMatches = wk.matches;
    const wLeague = wMatches.map(m => breakdown.league.find(l=>l.matchId===m.id)||{matchId:m.id,status:'pending',pick:picks.matches?.[m.id],pts:0});
    const correct = wLeague.filter(l=>l.status==='correct').length;
    const resolved = wLeague.filter(l=>l.status!=='pending').length;
    const hasAny = wLeague.some(l=>l.status!=='pending');

    const wg = document.createElement('div');
    wg.className = 'week-group' + (wi===0?' open':''); // first week open by default
    wg.innerHTML = `
      <div class="week-hd" onclick="this.parentElement.classList.toggle('open')">
        <div class="week-hd-left">
          <span class="week-label">${wk.weekLabel}</span>
          <span class="week-dates">${wk.dateRange}</span>
        </div>
        <div class="week-stats">
          ${hasAny?`<span class="week-correct">${correct}/${resolved} correct</span>`:''}
          <span class="chip chip-gold" style="font-size:9px;padding:2px 8px;">${wMatches.length} matches</span>
          <span class="week-chev">▾</span>
        </div>
      </div>
      <div class="week-body">
        <table class="mtable">
          <thead><tr><th>Date</th><th>Match</th><th>Your Pick</th><th>Result</th><th style="text-align:right">Pts</th></tr></thead>
          <tbody>${wMatches.map(m=>{
            const bd2 = wLeague.find(l=>l.matchId===m.id)||{status:'pending',pick:picks.matches?.[m.id],pts:0};
            const st=bd2.status;const pick=bd2.pick||'—';const ptsStr=st==='correct'?'+2':st==='incorrect'?'0':'—';
            return `<tr>
              <td class="mdate">${m.date}</td>
              <td><div class="mteams"><span class="dot ${m.c1}"></span>${m.t1}<span class="vs">vs</span><span class="dot ${m.c2}"></span>${m.t2}</div></td>
              <td><span class="pill pill-${st}"><span class="dot ${TD[pick]||''}"></span>${pick}</span></td>
              <td style="font-size:12px;color:var(--muted);">${bd2.result||'Pending'}</td>
              <td class="pts-cell" style="color:${st==='correct'?'var(--green)':st==='incorrect'?'var(--red)':'var(--muted)'};">${ptsStr}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
    container.appendChild(wg);
  });
}

function editActive(){
  const b=S.brackets.find(x=>x.pickId===S.activePickId);
  if(b)startEdit(b.groupId,b.picks.name);
}

// ─── GROUP LEADERBOARD ────────────────────────────────────────────────────────
async function loadGroup(overrideGid){
  const activeBracket=S.brackets.find(b=>b.pickId===S.activePickId)||S.brackets[0];
  const gid=(overrideGid||_viewingGroupId||activeBracket?.groupId)?.toUpperCase();
  if(!gid){
    document.getElementById('group-strip').style.display='none';
    document.getElementById('lb-body').innerHTML=`<div style="text-align:center;padding:48px;color:var(--muted);">Enter a group code above to view a leaderboard.</div>`;
    return;
  }
  _viewingGroupId=gid;
  try{
    const r=await fetch(`${API}/api/group/${gid}`);
    if(!r.ok)throw new Error('Group not found');
    const data=await r.json();
    document.getElementById('group-strip').style.display='';
    renderLB(data);
  }catch(e){
    document.getElementById('group-strip').style.display='none';
    document.getElementById('lb-body').innerHTML=`<div style="text-align:center;padding:48px;color:var(--muted);">Could not load group. Check your group code.</div>`;
  }
}

function viewGroup(){
  const code=document.getElementById('gc-input').value.trim().toUpperCase();
  if(!code)return toast('Enter a group code',true);
  loadGroup(code);
}

async function loadMyBracketFromServer(){
  const name=document.getElementById('lb-name-input').value.trim();
  const pin=document.getElementById('lb-pin-input').value.trim();
  if(!name)return toast('Enter your name',true);
  const gid=_viewingGroupId;
  if(!gid)return toast('View a group first',true);
  try{
    const params=new URLSearchParams({name,groupId:gid});
    if(pin)params.set('pin',pin);
    const r=await fetch(`${API}/api/picks/check?${params}`);
    const data=await r.json();
    if(r.status===401){
      if(data.pinRequired&&!pin)return toast('This bracket is PIN-protected — enter your PIN',true);
      return toast('Incorrect PIN',true);
    }
    if(!data.exists)return toast('No bracket found for that name in this group',true);
    upsertBracket(gid,data.pickId,data.picks,data.locked);
    S.activePickId=data.pickId;ls.set('ipl_activePickId',data.pickId);
    toast('Bracket loaded!');
    renderMy();
    loadGroup();
  }catch(e){toast(e.message,true);}
}

function renderLB(data){
  const gcEl=document.getElementById('gc-input');if(gcEl)gcEl.value=data.id||'';
  const gsNameEl=document.getElementById('gs-name');
  if(data.name){gsNameEl.textContent=data.name;}else{gsNameEl.innerHTML='MY <em>GROUP</em>';}
  document.getElementById('gs-code').textContent=data.id||'';
  const lb=data.leaderboard||[];
  document.getElementById('gs-members').textContent=lb.length;
  document.getElementById('gs-done').textContent=Object.keys(S.results.matches||{}).length;
  if(S.results.lastSynced)document.getElementById('gs-sync').textContent=ago(new Date(S.results.lastSynced));
  if(data.locked){document.getElementById('gs-lock').style.display='inline-flex';}else{document.getElementById('gs-lock').style.display='none';}

  const notice=document.getElementById('lb-notice');
  if(!data.locked)notice.textContent='🔒 Picks are hidden until the admin locks the group — only your own picks are visible.';
  else notice.textContent='';

  const lbb=document.getElementById('load-bracket-bar');
  lbb.style.display=S.brackets.some(b=>b.groupId===data.id)?'none':'flex';

  const body=document.getElementById('lb-body');
  if(!lb.length){body.innerHTML=`<div style="text-align:center;padding:48px;color:var(--muted);">No picks submitted yet.</div>`;return;}

  body.innerHTML='';
  const activeBracket=S.brackets.find(b=>b.pickId===S.activePickId);
  const myName=(activeBracket?.groupId===data.id?activeBracket:S.brackets.find(b=>b.groupId===data.id))?.picks?.name?.toLowerCase().trim();

  lb.forEach(entry=>{
    const rank=entry.rank||1;
    const isMe=entry.name?.toLowerCase().trim()===myName;
    const champHit=S.results.champion&&entry.champion===S.results.champion;
    const isWinner=rank===1&&S.results.champion;
    const isSecond=rank===2&&S.results.champion;

    let rankHTML=`<span style="color:var(--muted);font-size:22px;font-family:'Bebas Neue',sans-serif;">${rank}</span>`;
    if(isWinner) rankHTML=`<span style="font-size:22px;">👑</span>`;
    else if(isSecond) rankHTML=`<span style="font-size:20px;">🥈</span>`;

    const row=document.createElement('div');
    row.className='lb-row'+(isMe?' me':'')+(data.locked?'':' hidden-picks');
    row.innerHTML=`<div class="rank-cell">${rankHTML}</div>
      <div><div class="lb-name">${esc(entry.name)}${isMe?'<span class="me-tag">YOU</span>':''}</div>
        <div class="lb-name-sub">${entry.correctLeague||0}/${MATCHES.length} league ✓</div></div>
      <div class="lb-pts">${entry.pts}</div>
      <div class="lb-max">${entry.maxPts||'—'}</div>
      <div class="lb-champ lb-col-4 ${champHit?'hit':''}">
        ${data.locked?`<span class="dot ${TD[entry.champion]||''}"></span>${esc(entry.champion||'—')}`:'🔒 hidden'}</div>`;

    const detRow=document.createElement('div');
    detRow.className='lb-detail';
    if(data.locked&&entry.matchPicks?.length){
      detRow.innerHTML=buildDetail(entry);
      row.addEventListener('click',()=>detRow.classList.toggle('open'));
    } else if(!data.locked&&isMe){
      const myB=S.brackets.find(b=>b.pickId===S.activePickId&&b.groupId===data.id)||S.brackets.find(b=>b.groupId===data.id&&b.picks.name.toLowerCase().trim()===myName);
      if(myB){
        const {breakdown}=score(myB.picks,S.results);
        detRow.innerHTML=buildDetail({...entry,champion:myB.picks.champion,correctLeague:breakdown.league.filter(l=>l.status==='correct').length,matchPicks:breakdown.league});
        row.addEventListener('click',()=>detRow.classList.toggle('open'));
      }
    }
    body.appendChild(row);
    body.appendChild(detRow);
  });

  const myEntry=lb.find(e=>e.name?.toLowerCase().trim()===myName);
  if(myEntry)document.getElementById('my-rank').textContent=myEntry.rank||'—';
}

function buildDetail(entry){
  const picks=entry.matchPicks||[];
  return`<div class="detail-meta">
    <div class="dm">🏆 Champion: <strong>${esc(TI[entry.champion]||entry.champion||'—')}</strong></div>
    <div class="dm" style="color:var(--green);">✅ ${entry.correctLeague||0}/${MATCHES.length} correct</div>
  </div>
  <div style="font-size:9px;color:var(--muted);font-family:'Space Mono',monospace;letter-spacing:2px;margin-bottom:9px;">MATCH PICKS</div>
  <div class="dpicks">
    ${picks.map(l=>{
      const m=MATCHES.find(x=>x.id===l.matchId||String(x.id)===String(l.matchId));
      const i1=TI[m?.t1]||m?.t1||'?';const i2=TI[m?.t2]||m?.t2||'?';
      const p1=l.pick===m?.t1;const p2=l.pick===m?.t2;
      return`<div class="dp"><div><div class="dp-match">M${l.matchId} · ${m?.date||''}</div>
        <div class="dp-vs"><span class="dp-t${p1?' picked':''}">${i1}</span><span style="color:var(--muted);font-weight:400;font-size:9px;">vs</span><span class="dp-t${p2?' picked':''}">${i2}</span></div></div>
        <span class="chip ${l.status==='correct'?'chip-green':l.status==='incorrect'?'chip-red':'chip-gold'}" style="font-size:9px;padding:2px 5px;">
          ${l.status==='correct'?'+2':l.status==='incorrect'?'✗':'?'}</span></div>`;}).join('')}
  </div>`;
}

// ─── FORM BUILD ───────────────────────────────────────────────────────────────
function buildForm(){
  document.getElementById('fp-total').textContent = MATCHES.length;
  const container = document.getElementById('f-matches');

  WEEKS.forEach((wk, wi) => {
    const fg = document.createElement('div');
    fg.className = 'fw-group' + (wi===0 ? ' open' : '');
    fg.dataset.week = wi;

    const body = document.createElement('div');
    body.className = 'fw-body';

    wk.matches.forEach(m => {
      const d = document.createElement('div');
      d.className = 'mrow';
      d.dataset.matchId = m.id;
      d.innerHTML = `
        <div>
          <div class="mr-date">${m.date}</div>
          <div class="mr-venue">${m.venue}</div>
        </div>
        <div style="flex:1;">
          <div class="mr-id">MATCH ${m.id}</div>
          <div class="rg">
            <label class="rl">
              <input type="radio" name="m${m.id}" value="${m.t1}" onchange="onPickChange(${m.id},this.closest('.mrow'))">
              <div class="rc"></div>
              <span class="rl-name"><span class="dot ${m.c1}"></span> ${m.t1}</span>
            </label>
            <label class="rl">
              <input type="radio" name="m${m.id}" value="${m.t2}" onchange="onPickChange(${m.id},this.closest('.mrow'))">
              <div class="rc"></div>
              <span class="rl-name"><span class="dot ${m.c2}"></span> ${m.t2}</span>
            </label>
          </div>
        </div>`;
      body.appendChild(d);
    });

    fg.innerHTML = `
      <div class="fw-hd" onclick="toggleWeek(this.parentElement)">
        <div class="fw-hd-left">
          <span class="fw-label">${wk.weekLabel}</span>
          <span class="fw-dates">${wk.dateRange}</span>
        </div>
        <div class="fw-progress">
          <span class="fw-prog-text" data-wk="${wi}">0/${wk.matches.length}</span>
          <span class="fw-chev">▾</span>
        </div>
      </div>`;
    fg.appendChild(body);
    container.appendChild(fg);
  });

  // Semis + champion (unchanged)
  const sf=document.getElementById('f-semis');
  TEAMS.forEach(t=>{const l=document.createElement('label');l.className='cl';l.innerHTML=`<input type="checkbox" name="semi" value="${t}" onchange="cntSemis()"><div class="cc"></div><span class="cl-name"><span class="dot ${TD[t]||''}"></span> ${t}</span>`;sf.appendChild(l);});
  const cf=document.getElementById('f-champ');
  TEAMS.forEach(t=>{const l=document.createElement('label');l.className='cr';l.innerHTML=`<input type="radio" name="champion" value="${t}"><div class="crc"></div><span class="cr-name"><span class="dot ${TD[t]||''}"></span> ${t}</span>`;cf.appendChild(l);});
}

function toggleWeek(fg){
  fg.classList.toggle('open');
}

function onPickChange(matchId, mrow){
  if(mrow) mrow.classList.add('picked');
  updateFormProgress();
}

function updateFormProgress(){
  let done = 0;
  MATCHES.forEach(m=>{if(document.querySelector(`input[name=m${m.id}]:checked`))done++;});
  const pct = Math.round(done/MATCHES.length*100);
  document.getElementById('fp-bar').style.width = pct+'%';
  document.getElementById('fp-done').textContent = done;

  // Update per-week counters
  WEEKS.forEach((wk, wi) => {
    const wDone = wk.matches.filter(m=>document.querySelector(`input[name=m${m.id}]:checked`)).length;
    const el = document.querySelector(`.fw-prog-text[data-wk="${wi}"]`);
    if(el){
      el.textContent = `${wDone}/${wk.matches.length}`;
      el.className = 'fw-prog-text' + (wDone===wk.matches.length ? ' complete' : '');
    }
    // Auto-open next incomplete week when current week is fully picked
    if(wDone === wk.matches.length && wi < WEEKS.length-1){
      const groups = document.querySelectorAll('.fw-group');
      const nextGroup = groups[wi+1];
      if(nextGroup && !nextGroup.classList.contains('open')){
        // only auto-open if current group triggered it just now (all picked)
        // we do this silently — user can still collapse manually
      }
    }
  });
}

function cntSemis(){
  const n=document.querySelectorAll('input[name=semi]:checked').length;
  document.getElementById('semi-cnt').textContent=n;
  if(n>=4)document.querySelectorAll('input[name=semi]:not(:checked)').forEach(c=>c.disabled=true);
  else document.querySelectorAll('input[name=semi]').forEach(c=>c.disabled=false);
}

// ─── SUBMIT / EDIT ────────────────────────────────────────────────────────────
let _isSubmitting = false;
async function submitPicks(){
  if(_isSubmitting)return;
  const name=document.getElementById('f-name').value.trim();
  const gid=document.getElementById('f-group').value.trim().toUpperCase();
  if(!name)return toast('Enter your name',true);
  if(!gid)return toast('Enter group code',true);

  const matches={};
  for(const m of MATCHES){
    const p=document.querySelector(`input[name=m${m.id}]:checked`);
    if(!p)return toast(`Pick winner for Match ${m.id} (${m.date})`,true);
    matches[m.id]=p.value;
  }
  const semis=[...document.querySelectorAll('input[name=semi]:checked')].map(c=>c.value);
  if(semis.length!==4)return toast('Select exactly 4 semifinalists',true);
  const champ=document.querySelector('input[name=champion]:checked');
  if(!champ)return toast('Pick your Season Champion',true);
  const finalRunsVal=parseInt(document.getElementById('f-final-runs').value);
  if(!finalRunsVal||isNaN(finalRunsVal)||finalRunsVal<1)return toast('Enter your tiebreaker: total runs in the Final',true);

  const pinVal=document.getElementById('f-pin')?.value?.trim();
  if(!S.editMode&&!pinVal)return toast('Set a PIN to protect your bracket',true);
  const payload={name,groupId:gid,matches,semis,champion:champ.value,finalRuns:finalRunsVal};
  if(pinVal)payload.pin=pinVal;
  _isSubmitting=true;
  const btn=document.getElementById('sub-btn');
  btn.disabled=true;btn.innerHTML=`<span class="spin"></span> ${S.editMode?'Saving…':'Submitting…'}`;

  try{
    const method=S.editMode?'PUT':'POST';
    const r=await fetch(`${API}/api/picks`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json();

    if(r.status===409&&data.canEdit){
      btn.disabled=false;btn.innerHTML='SUBMIT BRACKET →';
      if(confirm(`You already have a bracket in group ${gid}. Edit it?`)){
        const chk=await(await fetch(`${API}/api/picks/check?name=${encodeURIComponent(name)}&groupId=${gid}`)).json();
        if(chk.exists&&chk.picks){upsertBracket(gid,chk.pickId,chk.picks,chk.locked);startEdit(gid,name);}
      }
      return;
    }
    if(!r.ok)throw new Error(data.error||'Failed');

    const finalPayload={...payload,submittedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    upsertBracket(gid,data.pickId,finalPayload,false);
    S.activePickId=data.pickId;ls.set('ipl_activePickId',data.pickId);

    toast(S.editMode?'✅ Bracket updated!':'🏏 Bracket submitted!');
    if(S.editMode)cancelEdit();
    setTimeout(()=>goTab('my'),1200);
  }catch(e){toast(e.message,true);}
  finally{_isSubmitting=false;btn.disabled=false;btn.innerHTML=S.editMode?'💾 SAVE CHANGES →':'SUBMIT BRACKET →';}
}

function upsertBracket(gid,pickId,picks,locked){
  const idx=S.brackets.findIndex(b=>b.groupId===gid&&b.picks.name.toLowerCase().trim()===picks.name.toLowerCase().trim());
  const entry={groupId:gid,pickId,picks,locked:locked||false};
  if(idx>=0)S.brackets[idx]=entry;else S.brackets.push(entry);
  ls.set('ipl_brackets',S.brackets);
}

// ─── EDIT MODE ────────────────────────────────────────────────────────────────
function startEdit(gid,name){
  const b=S.brackets.find(x=>x.groupId===gid&&x.picks.name.toLowerCase().trim()===name.toLowerCase().trim());
  if(!b)return toast('Bracket not found',true);
  S.editMode=true;S.editGid=gid;
  document.getElementById('f-name').value=name;document.getElementById('f-name').readOnly=true;
  document.getElementById('f-group').value=gid;document.getElementById('f-group').readOnly=true;
  document.getElementById('eb-sub').textContent=`Editing bracket for group ${gid}.`;
  document.getElementById('edit-banner').style.display='flex';
  document.getElementById('sub-btn').innerHTML='💾 SAVE CHANGES →';
  const weeksToOpen=new Set();
  MATCHES.forEach(m=>{
    const p=document.querySelector(`input[name=m${m.id}][value="${b.picks.matches?.[m.id]||''}"]`);
    if(p){p.checked=true; const row=p.closest('.mrow'); if(row)row.classList.add('picked');
      const wk=p.closest('.fw-group'); if(wk)weeksToOpen.add(wk);}
  });
  weeksToOpen.forEach(wk=>wk.classList.add('open'));
  document.querySelectorAll('input[name=semi]').forEach(c=>{c.checked=(b.picks.semis||[]).includes(c.value);c.disabled=false;});
  cntSemis();
  document.querySelectorAll('input[name=champion]').forEach(r=>r.checked=r.value===b.picks.champion);
  const _fr=document.getElementById('f-final-runs');if(_fr&&b.picks.finalRuns)_fr.value=b.picks.finalRuns;
  updateFormProgress();
  goTab('enter');window.scrollTo({top:0,behavior:'smooth'});
}

function cancelEdit(){
  S.editMode=false;S.editGid=null;
  document.getElementById('edit-banner').style.display='none';
  document.getElementById('sub-btn').innerHTML='SUBMIT BRACKET →';
  document.getElementById('f-name').readOnly=false;document.getElementById('f-group').readOnly=false;
  document.getElementById('f-name').value='';document.getElementById('f-group').value='';
  const _fp=document.getElementById('f-pin');if(_fp)_fp.value='';
  const _fr2=document.getElementById('f-final-runs');if(_fr2)_fr2.value='';
  document.querySelectorAll('input[name^=m],input[name=semi],input[name=champion]').forEach(el=>{el.checked=false;el.disabled=false;});
  document.querySelectorAll('.mrow').forEach(r=>r.classList.remove('picked'));
  document.getElementById('semi-cnt').textContent='0';
  updateFormProgress();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg,err=false){
  document.getElementById('t-icon').textContent=err?'⚠️':'✅';
  document.getElementById('t-msg').textContent=msg;
  const el=document.getElementById('toast');
  el.className='show'+(err?' err':'');
  clearTimeout(window._tt);window._tt=setTimeout(()=>el.className='',3500);
}

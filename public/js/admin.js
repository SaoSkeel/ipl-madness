'use strict';
const API=window.location.origin;
let PW='';
const actLog=[];
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const TEAMS=['Royal Challengers Bengaluru','Mumbai Indians','Delhi Capitals','Chennai Super Kings','Sunrisers Hyderabad','Punjab Kings','Rajasthan Royals','Gujarat Titans','Kolkata Knight Riders','Lucknow Super Giants'];
// Derived from fixtures.js (loaded via <script src="fixtures.js">)
const MATCHES=(typeof FIXTURES!=='undefined'?FIXTURES:[]).map(f=>({id:f.id,date:f.label,t1:f.t1,t2:f.t2}));

async function unlock(){
  PW=document.getElementById('pw').value;
  try{
    const r=await fetch(`${API}/api/admin/dashboard`,{headers:{'x-admin-password':PW}});
    if(!r.ok)throw new Error();
    const data=await r.json();
    document.getElementById('lock-screen').style.display='none';
    document.getElementById('admin').style.display='block';
    buildForms();renderDash(data);
  }catch{document.getElementById('pw-err').style.display='block';}
}

function buildForms(){
  const ms=document.getElementById('or-match');
  MATCHES.forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=`M${m.id} (${m.date}): ${m.t1} vs ${m.t2}`;ms.appendChild(o);});
  const cs=document.getElementById('or-champ');
  TEAMS.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;cs.appendChild(o);});
  const sc=document.getElementById('semi-checks');
  TEAMS.forEach(t=>{const l=document.createElement('label');l.style.cssText='display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;background:rgba(255,255,255,.05);padding:5px 10px;border-radius:6px;';l.innerHTML=`<input type="checkbox" name="semi-or" value="${t}"> ${t}`;sc.appendChild(l);});
}

function fillWinners(){
  const mid=parseInt(document.getElementById('or-match').value);
  const m=MATCHES.find(x=>x.id===mid);
  const ws=document.getElementById('or-winner');
  ws.innerHTML='<option value="">Select winner…</option>';
  if(m)[m.t1,m.t2].forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;ws.appendChild(o);});
}

async function post(path,body){
  const r=await fetch(`${API}${path}`,{method:'POST',headers:{'Content-Type':'application/json','x-admin-password':PW},body:JSON.stringify(body)});
  return r.json();
}
async function del(path){
  const r=await fetch(`${API}${path}`,{method:'DELETE',headers:{'x-admin-password':PW}});
  return r.json();
}

async function loadDash(){
  const r=await fetch(`${API}/api/admin/dashboard`,{headers:{'x-admin-password':PW}});
  renderDash(await r.json());
}

function renderDash(data){
  const groups=data.groups||[];const results=data.results||{};
  document.getElementById('d-groups').textContent=groups.length;
  document.getElementById('d-entries').textContent=groups.reduce((s,g)=>s+(g.memberCount||0),0);
  document.getElementById('d-results').textContent=Object.keys(results.matches||{}).length+'/'+MATCHES.length;
  if(results.lastSynced)document.getElementById('sync-info').textContent='Last sync: '+new Date(results.lastSynced).toLocaleString();
  document.getElementById('results-log').textContent=JSON.stringify(results,null,2);

  const tb=document.getElementById('groups-tbody');tb.innerHTML='';
  if(!groups.length){tb.innerHTML='<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px;">No groups.</td></tr>';return;}
  groups.forEach(g=>{
    const tr=document.createElement('tr');tr.style.cursor='pointer';
    tr.innerHTML=`<td style="font-family:'Space Mono',monospace;font-size:10px;color:var(--gold);">${esc(g.id)}</td>
      <td style="font-weight:600;">${esc(g.name)}</td>
      <td>${g.memberCount||0}</td>
      <td><span style="color:${g.locked?'var(--red)':'var(--green)'};">${g.locked?'🔒 Locked':'🔓 Open'}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="bsm bgrn" onclick="event.stopPropagation();toggleLock('${esc(g.id)}',${!g.locked})">${g.locked?'Unlock':'Lock'}</button>
        <button class="bsm members-btn">👥 Members</button>
        <button class="bsm bred" onclick="event.stopPropagation();deleteGroup('${esc(g.id)}')">🗑 Delete</button>
      </td>`;
    tr.querySelector('.members-btn').addEventListener('click', e=>{e.stopPropagation();loadMembers(g.id,g.name);});
    tb.appendChild(tr);
  });
}

async function loadMembers(gid,name){
  const panel=document.getElementById('members-panel');
  document.getElementById('mp-title').textContent=`MEMBERS — ${name} (${gid})`;
  document.getElementById('members-list').innerHTML='<div style="color:var(--muted);font-size:12px;">Loading…</div>';
  panel.style.display='block';panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  try{
    const r=await fetch(`${API}/api/admin/group/${gid}/picks`,{headers:{'x-admin-password':PW}});
    const data=await r.json();
    const list=document.getElementById('members-list');
    if(!data.picks?.length){list.innerHTML='<div style="color:var(--muted);font-size:12px;">No picks yet.</div>';return;}
    list.innerHTML='';
    data.picks.forEach(p=>{
      const div=document.createElement('div');div.className='member-row';
      div.innerHTML=`<div class="member-info">
        <span style="font-weight:700;font-size:13px;">${esc(p.name)}</span>
        <span style="font-size:10px;color:var(--muted);font-family:'Space Mono',monospace;">${p.submittedAt?new Date(p.submittedAt).toLocaleDateString():''}</span>
        ${p.updatedAt&&p.updatedAt!==p.submittedAt?'<span style="font-size:10px;color:var(--blue);">edited</span>':''}
        <span style="font-size:10px;color:var(--muted);font-family:'Space Mono',monospace;">${esc(p.pickId)}</span>
        ${p.pin?'<span class="pin-badge">🔒 PIN set</span>':'<span style="font-size:10px;color:var(--muted);font-family:\'Space Mono\',monospace;">no PIN</span>'}
      </div>
      <div style="display:flex;gap:6px;">
        ${p.pin?'<button class="bsm reset-pin-btn">Reset PIN</button>':''}
        <button class="bsm bred delete-pick-btn">🗑 Delete</button>
      </div>`;
      div.querySelector('.delete-pick-btn').addEventListener('click',()=>deletePick(gid,p.pickId,p.name));
      div.querySelector('.reset-pin-btn')?.addEventListener('click',()=>resetPin(gid,p.pickId,p.name,div));
      list.appendChild(div);
    });
  }catch(e){document.getElementById('members-list').innerHTML=`<div style="color:var(--red);font-size:12px;">${e.message}</div>`;}
}

async function resetPin(gid,pickId,name,rowEl){
  if(!confirm(`Reset PIN for "${name}"?\nThey can set a new one when they next edit their bracket.`))return;
  const r=await fetch(`${API}/api/admin/group/${gid}/picks/${encodeURIComponent(pickId)}/reset-pin`,{method:'POST',headers:{'x-admin-password':PW}});
  const data=await r.json();
  if(data.ok){
    toast(`PIN reset for ${name}`);
    addLog(`[Reset PIN] ${name} in ${gid}`);
    rowEl.querySelector('.pin-badge')?.remove();
    rowEl.querySelector('.reset-pin-btn')?.remove();
  }else toast(data.error,true);
}

async function deletePick(gid,pickId,name){
  if(!confirm(`Delete bracket for "${name}" from group ${gid}?\nThis cannot be undone.`))return;
  const r=await del(`/api/admin/group/${gid}/picks/${encodeURIComponent(pickId)}`);
  if(r.ok){toast(`Deleted ${name}`);addLog(`[Delete] ${name} from ${gid}`);loadDash();loadMembers(gid,'');}
  else toast(r.error,true);
}

async function deleteGroup(gid){
  if(!confirm(`DELETE entire group ${gid} and ALL its picks?\nThis is irreversible.`))return;
  const r=await del(`/api/admin/group/${gid}`);
  if(r.ok){toast(`Group ${gid} deleted`);addLog(`[Delete Group] ${gid}`);loadDash();document.getElementById('members-panel').style.display='none';}
  else toast(r.error,true);
}

async function createGroup(){
  const name=document.getElementById('g-name').value.trim();
  const code=document.getElementById('g-code').value.trim();
  if(!name||!code)return toast('Name and code required',true);
  const r=await post('/api/admin/group',{name,code});
  if(r.ok){toast(`Group ${r.id} created`);loadDash();}else toast(r.error,true);
}

async function toggleLock(id,lock){
  const r=await post(`/api/admin/group/${id}/lock`,{locked:lock});
  if(r.ok){toast(`Group ${id} ${lock?'locked':'unlocked'}`);loadDash();}else toast(r.error,true);
}

async function overrideMatch(){
  const matchId=document.getElementById('or-match').value;
  const winner=document.getElementById('or-winner').value;
  if(!matchId||!winner)return toast('Select match and winner',true);
  const r=await post('/api/admin/result',{matchId:parseInt(matchId),winner});
  if(r.ok){toast(`M${matchId} → ${winner}`);addLog(`[Result] M${matchId}: ${winner}`);loadDash();}else toast(r.error,true);
}

async function overrideChamp(){
  const champion=document.getElementById('or-champ').value;
  if(!champion)return toast('Select champion',true);
  const r=await post('/api/admin/result',{champion});
  if(r.ok){toast(`Champion: ${champion}`);addLog(`[Champion] ${champion}`);loadDash();}else toast(r.error,true);
}

async function overrideSemis(){
  const checked=[...document.querySelectorAll('input[name=semi-or]:checked')].map(c=>c.value);
  if(checked.length!==4)return toast('Select exactly 4 semifinalists',true);
  const r=await post('/api/admin/result',{semis:checked});
  if(r.ok){toast('Semis updated');addLog(`[Semis] ${checked.join(', ')}`);loadDash();}else toast(r.error,true);
}

async function overridePts(){
  const pickId=document.getElementById('or-pickid').value.trim();
  const pts=parseInt(document.getElementById('or-pts').value);
  if(!pickId||isNaN(pts))return toast('Enter pickId and points',true);
  const r=await post('/api/admin/result',{pointOverrides:{[pickId]:pts}});
  if(r.ok){toast(`Points set: ${pickId} → ${pts}`);addLog(`[PtsOverride] ${pickId}: ${pts}`);loadDash();}else toast(r.error,true);
}

async function forceSync(){
  toast('Syncing…');
  const r=await post('/api/admin/sync',{});
  if(r.ok){toast(`Sync done · ${r.matchesKnown||0} results`);addLog(`[Sync] ${new Date().toLocaleTimeString()}: changed=${r.changed}`);loadDash();}
  else toast(r.error,true);
}

function addLog(msg){actLog.unshift(msg);if(actLog.length>100)actLog.pop();document.getElementById('act-log').textContent=actLog.slice(0,60).join('\n');}
function toast(msg,err=false){
  document.getElementById('t-icon').textContent=err?'⚠️':'✅';
  document.getElementById('t-msg').textContent=msg;
  const el=document.getElementById('toast');
  el.className='show'+(err?' err':'');
  clearTimeout(window._tt);window._tt=setTimeout(()=>el.className='',3000);
}

document.getElementById('pw').focus();

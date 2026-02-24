#!/usr/bin/env python3
"""
zKill Activity Annotator — Phase 2 Label Correction Tool
=========================================================
Connects DIRECTLY to PostgreSQL — no dependency on server.py at all.

Usage:
  python annotator.py --db "postgres://user:pass@localhost:5432/postgres"

Then open http://localhost:9090 in your browser.

Requirements:
  pip install aiohttp asyncpg
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone

try:
    from aiohttp import web
except ImportError:
    print("Install dependencies: pip install aiohttp asyncpg")
    sys.exit(1)

try:
    import asyncpg
except ImportError:
    print("Install dependencies: pip install asyncpg")
    sys.exit(1)

CLASSES = [
    "camp",
    "smartbomb",
    "roaming_camp",
    "battle",
    "roam",
    "solo_roam",
    "gatecamp_migrating",
    "activity",
]
CLASS_COLORS = {
    "camp": "#ff4444",
    "smartbomb": "#ff8844",
    "roaming_camp": "#ffcc33",
    "battle": "#8844ff",
    "roam": "#4488ff",
    "solo_roam": "#44ccff",
    "gatecamp_migrating": "#ff6644",
    "activity": "#888888",
}
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

HTML = "<!DOCTYPE html>\n<html lang=\"en\"><head>\n<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>zKill Annotator</title>\n<style>\n  :root { --bg: #0a0a0f; --surface1: #12121a; --surface2: #1a1a26; --surface3: #222233; --text: #e5e5e5; --dim: #888; --dimmer: #555; }\n  * { box-sizing: border-box; margin: 0; padding: 0; }\n  body { background: var(--bg); color: var(--text); font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; }\n  .mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }\n  .container { max-width: 1400px; margin: 0 auto; padding: 0 1.5rem; }\n  header { background: var(--surface1); border-bottom: 1px solid var(--surface3); padding: 0.75rem 0; position: sticky; top: 0; z-index: 10; }\n  header .inner { display: flex; align-items: center; justify-content: space-between; }\n  header h1 { font-size: 1.1rem; font-weight: 600; }\n  header h1 span { color: #ff4444; }\n  .stats-bar { display: flex; gap: 1.5rem; padding: 0.75rem 0; border-bottom: 1px solid var(--surface3); font-size: 0.75rem; }\n  .stats-bar .stat { display: flex; flex-direction: column; }\n  .stats-bar .stat-val { font-size: 1.2rem; font-weight: 700; color: var(--text); }\n  .stats-bar .stat-label { color: var(--dimmer); text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; }\n  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 1rem 0; align-items: center; }\n  .btn { padding: 0.35rem 0.75rem; border-radius: 9999px; font-size: 0.7rem; cursor: pointer; border: 1px solid var(--surface3); background: transparent; color: var(--dim); transition: all 0.15s; font-family: inherit; }\n  .btn:hover { color: var(--text); border-color: #666; }\n  .btn.active { background: rgba(255,255,255,0.08); border-color: #666; color: var(--text); }\n  .btn.primary { background: #4488ff22; border-color: #4488ff55; color: #6699ff; }\n  .btn.success { background: #44cc6622; border-color: #44cc6655; color: #66dd88; }\n  .btn.danger { background: #ff444422; border-color: #ff444455; color: #ff6666; }\n  .sessions { display: flex; flex-direction: column; gap: 0.5rem; padding-bottom: 2rem; }\n  .session { background: var(--surface1); border: 1px solid rgba(34,34,51,0.5); border-radius: 0.5rem; overflow: hidden; transition: border-color 0.15s; }\n  .session:hover { border-color: var(--surface3); }\n  .session.annotated { border-left: 3px solid #44cc66; }\n  .session.corrected { border-left: 3px solid #ff8844; }\n  .session-header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; cursor: pointer; flex-wrap: wrap; }\n  .session-header:hover { background: rgba(26,26,38,0.5); }\n  .badge { display: inline-flex; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.05em; border: 1px solid; }\n  .session-meta { display: flex; gap: 1rem; align-items: center; margin-left: auto; font-size: 0.7rem; }\n  .session-detail { padding: 1rem; border-top: 1px solid var(--surface3); display: none; }\n  .session-detail.open { display: block; }\n  .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem; }\n  .detail-section h4 { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dimmer); margin-bottom: 0.5rem; }\n  .classify-row { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0.75rem 0; align-items: center; }\n  .classify-btn { padding: 0.3rem 0.6rem; border-radius: 0.25rem; font-size: 0.65rem; font-weight: 600; cursor: pointer; border: 1px solid; transition: all 0.15s; background: transparent; }\n  .classify-btn:hover { filter: brightness(1.3); }\n  .classify-btn.selected { filter: brightness(1.5); box-shadow: 0 0 8px rgba(255,255,255,0.1); }\n  .note-input { width: 100%; background: var(--surface2); border: 1px solid var(--surface3); border-radius: 0.375rem; padding: 0.5rem; color: var(--text); font-size: 0.75rem; font-family: inherit; resize: vertical; min-height: 2rem; }\n  .note-input:focus { outline: none; border-color: #4488ff55; }\n  .split-section { margin-top: 0.75rem; }\n  .kill-timeline { display: flex; flex-direction: column; gap: 0.25rem; }\n  .kill-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; border-radius: 0.25rem; font-size: 0.7rem; cursor: pointer; transition: background 0.1s; }\n  .kill-row:hover { background: var(--surface2); }\n  .kill-row.split-point { background: rgba(255,136,68,0.15); border-left: 2px solid #ff8844; }\n  .ships-list { display: flex; flex-wrap: wrap; gap: 0.25rem; }\n  .ship-tag { font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 0.25rem; border: 1px solid rgba(34,34,51,0.5); }\n  .victims-list { display: flex; flex-wrap: wrap; gap: 0.25rem; }\n  .status-msg { position: fixed; bottom: 1rem; right: 1rem; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.75rem; z-index: 100; animation: fadeout 2s 1s forwards; }\n  .status-msg.ok { background: #44cc6633; border: 1px solid #44cc6655; color: #66dd88; }\n  .status-msg.err { background: #ff444433; border: 1px solid #ff444455; color: #ff6666; }\n  @keyframes fadeout { to { opacity: 0; pointer-events: none; } }\n  .empty { text-align: center; padding: 4rem 0; color: var(--dim); }\n</style>\n</head><body>\n<header><div class=\"container inner\">\n  <h1><span>z</span>Kill Annotator</h1>\n  <div style=\"display:flex;gap:1rem;align-items:center\">\n    <span class=\"mono\" style=\"font-size:0.7rem;color:var(--dimmer)\">Direct DB</span>\n    <button class=\"btn primary\" onclick=\"exportData()\">Export Training Data</button>\n  </div>\n</div></header>\n<div class=\"container\">\n  <div class=\"stats-bar\" id=\"stats-bar\"></div>\n  <div class=\"controls\" id=\"controls\"></div>\n  <div class=\"sessions\" id=\"sessions\"></div>\n</div>\n<script>\nconst CLASSES = [\"camp\", \"smartbomb\", \"roaming_camp\", \"battle\", \"roam\", \"solo_roam\", \"gatecamp_migrating\", \"activity\"];\nconst CLASS_COLORS = {\"camp\": \"#ff4444\", \"smartbomb\": \"#ff8844\", \"roaming_camp\": \"#ffcc33\", \"battle\": \"#8844ff\", \"roam\": \"#4488ff\", \"solo_roam\": \"#44ccff\", \"gatecamp_migrating\": \"#ff6644\", \"activity\": \"#888888\"};\nconst DAYS = [\"Mon\", \"Tue\", \"Wed\", \"Thu\", \"Fri\", \"Sat\", \"Sun\"];\nlet allSessions=[], filter='pending', expanded=null, splitPoints={};\nfunction badge(cls){const c=CLASS_COLORS[cls]||'#888';return `<span class=\"badge mono\" style=\"color:${c};border-color:${c}33;background:${c}15\">${(cls||'?').toUpperCase().replace(/_/g,' ')}</span>`;}\nfunction formatIsk(v){if(v>=1e9)return (v/1e9).toFixed(2)+'B';if(v>=1e6)return (v/1e6).toFixed(1)+'M';if(v>=1e3)return (v/1e3).toFixed(0)+'K';return (v||0).toFixed(0);}\nfunction formatDur(m){if(!m||m<1)return '<1m';if(m<60)return Math.round(m)+'m';const h=Math.floor(m/60),mn=Math.round(m%60);return mn>0?h+'h '+mn+'m':h+'h';}\nfunction parseJ(s){try{return typeof s==='string'?JSON.parse(s):s;}catch{return null;}}\nasync function fetchStats(){\n  try{\n    const r=await fetch('/api/annotations/stats'),s=await r.json();\n    document.getElementById('stats-bar').innerHTML=`\n      <div class=\"stat\"><span class=\"stat-val mono\">${s.total_sessions||0}</span><span class=\"stat-label\">Total Sessions</span></div>\n      <div class=\"stat\"><span class=\"stat-val mono\" style=\"color:#44cc66\">${s.annotated||0}</span><span class=\"stat-label\">Annotated</span></div>\n      <div class=\"stat\"><span class=\"stat-val mono\" style=\"color:#ff8844\">${s.corrections||0}</span><span class=\"stat-label\">Corrections</span></div>\n      <div class=\"stat\"><span class=\"stat-val mono\">${s.pending||0}</span><span class=\"stat-label\">Pending</span></div>\n      <div class=\"stat\"><span class=\"stat-val mono\" style=\"color:#8844ff\">${s.splits||0}</span><span class=\"stat-label\">Splits</span></div>\n      <div class=\"stat\"><span class=\"stat-val mono\">${s.total_sessions>0?Math.round((s.annotated||0)/s.total_sessions*100):0}%</span><span class=\"stat-label\">Progress</span></div>`;\n  }catch(e){console.error('Stats error',e);}\n}\nasync function fetchSessions(){\n  try{\n    const ep=filter==='pending'?'/api/annotations/pending?limit=100':filter==='annotated'?'/api/annotations/all?limit=200&annotated_only=true':'/api/annotations/all?limit=200';\n    const r=await fetch(ep);allSessions=await r.json();renderSessions();\n  }catch(e){console.error('Fetch error',e);}\n}\nfunction renderControls(){\n  document.getElementById('controls').innerHTML=`\n    <button class=\"btn ${filter==='pending'?'active':''}\" onclick=\"setFilter('pending')\">Pending</button>\n    <button class=\"btn ${filter==='all'?'active':''}\" onclick=\"setFilter('all')\">All</button>\n    <button class=\"btn ${filter==='annotated'?'active':''}\" onclick=\"setFilter('annotated')\">Annotated</button>\n    <span class=\"mono\" style=\"margin-left:auto;font-size:0.7rem;color:var(--dimmer)\">${allSessions.length} sessions</span>\n    <button class=\"btn\" onclick=\"fetchSessions();fetchStats()\">Refresh</button>`;\n}\nfunction setFilter(f){filter=f;renderControls();fetchSessions();}\nfunction renderSessions(){\n  renderControls();\n  const el=document.getElementById('sessions');\n  if(!allSessions.length){el.innerHTML='<div class=\"empty mono\">No sessions found</div>';return;}\n  el.innerHTML=allSessions.map(s=>{\n    const isExp=expanded===s.session_id,isAnnotated=!!s.verified_class,isCorrected=isAnnotated&&s.verified_class!==s.classification;\n    const ships=parseJ(s.ship_composition)||{},victims=parseJ(s.victim_types)||{};\n    const killIds=parseJ(s.kill_ids)||[],systemPath=parseJ(s.system_path)||[];\n    const dt=new Date(s.start_time),splits=parseJ(s.split_points)||[],sid=s.session_id;\n    return `\n    <div class=\"session ${isAnnotated?'annotated':''} ${isCorrected?'corrected':''}\">\n      <div class=\"session-header\" onclick=\"toggle(&apos;${sid}&apos;)\">\n        ${badge(s.verified_class||s.classification)}\n        ${isCorrected?'<span style=\"font-size:0.6rem;color:#ff8844\" class=\"mono\">was: '+s.classification+'</span>':''}\n        <div style=\"display:flex;flex-direction:column;min-width:120px\">\n          <span style=\"font-size:0.85rem;font-weight:500\">${s.end_system_name||s.start_system_name||'?'}</span>\n          <span style=\"font-size:0.7rem;color:var(--dimmer)\">${s.end_region||s.start_region||''}</span>\n        </div>\n        ${s.stargate_name?'<span class=\"mono\" style=\"font-size:0.7rem;color:var(--dim)\">'+s.stargate_name+'</span>':''}\n        <div class=\"session-meta mono\">\n          <span>${s.kill_count} kills</span>\n          <span style=\"color:var(--dim)\">${formatIsk(s.total_value)}</span>\n          <span style=\"color:var(--dim)\">${formatDur(s.duration_minutes)}</span>\n          <span style=\"color:var(--dimmer)\">${s.member_count} chars</span>\n          <span style=\"color:var(--dimmer)\">${DAYS[s.day_of_week]} ${String(s.hour_of_day).padStart(2,'0')}:00</span>\n          <span style=\"color:var(--dimmer)\">${isExp?'&#9650;':'&#9660;'}</span>\n        </div>\n      </div>\n      <div class=\"session-detail ${isExp?'open':''}\">\n        <div class=\"detail-grid\">\n          <div class=\"detail-section\"><h4>Time</h4><div>${dt.toLocaleString()}</div><div style=\"color:var(--dim)\">${formatDur(s.duration_minutes)} duration</div></div>\n          <div class=\"detail-section\"><h4>Route</h4><div>${s.start_system_name||'?'} &#8594; ${s.end_system_name||'?'}</div><div style=\"color:var(--dim)\">${s.systems_visited} system${s.systems_visited>1?'s':''}</div>${systemPath.length>1?'<div style=\"font-size:0.65rem;color:var(--dimmer);margin-top:0.25rem\" class=\"mono\">'+systemPath.map(p=>p.name).join(' &#8594; ')+'</div>':''}</div>\n          <div class=\"detail-section\"><h4>Damage</h4><div>${s.kill_count} kills (${s.pod_kills||0} pods)</div><div style=\"color:var(--dim)\">${formatIsk(s.total_value)} ISK</div><div style=\"color:var(--dim)\">Avg: ${formatIsk(s.avg_value_per_kill||0)}/kill</div></div>\n          <div class=\"detail-section\"><h4>Comp</h4><div>${s.member_count} chars / ${s.corp_count} corps / ${s.alliance_count} alliances</div><div class=\"ships-list\" style=\"margin-top:0.25rem\">${Object.values(ships).sort((a,b)=>b.count-a.count).map(sh=>{const c=CLASS_COLORS[sh.category]||'#888';return '<span class=\"ship-tag mono\" style=\"color:'+c+';border-color:'+c+'33\">'+sh.name+' ×'+sh.count+'</span>';}).join('')}</div></div>\n        </div>\n        ${Object.keys(victims).length?`<div class=\"detail-section\" style=\"margin-bottom:0.75rem\"><h4>Victims</h4><div class=\"victims-list\">${Object.values(victims).sort((a,b)=>b.count-a.count).map(v=>'<span class=\"ship-tag mono\" style=\"color:var(--dim)\">'+v.name+' ×'+v.count+'</span>').join('')}</div></div>`:''}\n        <div class=\"detail-section\"><h4>Killmails</h4><div style=\"display:flex;flex-wrap:wrap;gap:0.25rem\">${killIds.map(kid=>'<a href=\"https://zkillboard.com/kill/'+kid+'/\" target=\"_blank\" rel=\"noopener\" class=\"mono\" style=\"font-size:0.6rem;color:#4488ff99;text-decoration:none\">#'+kid+'</a>').join('')}</div></div>\n        <div style=\"margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--surface3)\">\n          <h4 style=\"font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--dimmer);margin-bottom:0.5rem\">Classify This Activity</h4>\n          <div class=\"classify-row\">\n            ${CLASSES.map(cls=>{const c=CLASS_COLORS[cls]||'#888',sel=(s.verified_class||'')===cls?'selected':'';return '<button class=\"classify-btn '+sel+'\" style=\"color:'+c+';border-color:'+c+'33;background:'+c+'15\" onclick=\"classify(&apos;'+sid+'&apos;,&apos;'+cls+'&apos;)\">'+cls.toUpperCase().replace(/_/g,' ')+'</button>';}).join('')}\n            <button class=\"btn success\" onclick=\"confirmClassification(&apos;${sid}&apos;,&apos;${s.classification}&apos;)\" style=\"margin-left:0.5rem\">&#10003; Confirm Original</button>\n          </div>\n          <textarea class=\"note-input\" id=\"note-${sid}\" placeholder=\"Optional note...\" rows=\"1\">${s.annotation_note||''}</textarea>\n        </div>\n        ${killIds.length>2?`\n        <div class=\"split-section\">\n          <h4 style=\"font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--dimmer);margin-bottom:0.5rem\">Split Points</h4>\n          <div class=\"kill-timeline\">${killIds.map((kid,idx)=>{const isSp=splits.some(sp=>sp.kill_index===idx),spCls=splits.find(sp=>sp.kill_index===idx);return '<div class=\"kill-row '+(isSp?'split-point':'')+'\" onclick=\"toggleSplit(&apos;'+sid+'&apos;,'+idx+','+kid+')\"><span class=\"mono\" style=\"font-size:0.65rem;color:var(--dimmer)\">#'+idx+'</span><a href=\"https://zkillboard.com/kill/'+kid+'/\" target=\"_blank\" rel=\"noopener\" class=\"mono\" style=\"font-size:0.65rem;color:#4488ff99;text-decoration:none\" onclick=\"event.stopPropagation()\">Kill '+kid+'</a>'+(isSp?' '+badge(spCls.classification||'split'):'')+'</div>';}).join('')}</div>\n          <div style=\"display:flex;gap:0.25rem;margin-top:0.5rem;flex-wrap:wrap\">${splits.length>0?'<button class=\"btn danger\" onclick=\"clearSplits(&apos;'+sid+'&apos;)\">Clear Splits</button><button class=\"btn success\" onclick=\"saveSplits(&apos;'+sid+'&apos;)\">Save Splits</button>':'<span style=\"font-size:0.65rem;color:var(--dimmer)\">Click a kill to mark where the activity type changed</span>'}</div>\n        </div>`:''}\n      </div>\n    </div>`;\n  }).join('');\n}\nfunction toggle(sid){expanded=expanded===sid?null:sid;renderSessions();}\nasync function classify(sid,cls){\n  const note=document.getElementById('note-'+sid)?.value||'';\n  try{const r=await fetch('/api/annotations/'+sid+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({verified_class:cls,note})});const d=await r.json();if(d.ok)showMsg('Classified as '+cls.toUpperCase(),'ok');else showMsg('Error: '+(d.error||'unknown'),'err');}catch(e){showMsg('Failed: '+e.message,'err');}\n  fetchSessions();fetchStats();\n}\nfunction confirmClassification(sid,origClass){classify(sid,origClass);}\nfunction toggleSplit(sid,killIndex,killId){\n  if(!splitPoints[sid])splitPoints[sid]=[];\n  const idx=splitPoints[sid].findIndex(sp=>sp.kill_index===killIndex);\n  if(idx>=0){splitPoints[sid].splice(idx,1);}else{const cls=prompt('Classification after this kill:');if(cls)splitPoints[sid].push({kill_index:killIndex,kill_id:killId,classification:cls});}\n  const s=allSessions.find(s=>s.session_id===sid);if(s)s.split_points=JSON.stringify(splitPoints[sid]);renderSessions();\n}\nfunction clearSplits(sid){splitPoints[sid]=[];const s=allSessions.find(s=>s.session_id===sid);if(s)s.split_points='[]';renderSessions();}\nasync function saveSplits(sid){\n  const note=document.getElementById('note-'+sid)?.value||'';\n  try{const r=await fetch('/api/annotations/'+sid+'/split',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({split_points:splitPoints[sid]||[],note})});const d=await r.json();if(d.ok)showMsg('Splits saved','ok');else showMsg('Error: '+(d.error||'unknown'),'err');}catch(e){showMsg('Failed: '+e.message,'err');}\n  fetchSessions();fetchStats();\n}\nasync function exportData(){\n  try{const r=await fetch('/api/annotations/export');const data=await r.json();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='training_data_'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);showMsg('Exported '+(data.total_annotated||0)+' annotated sessions','ok');}catch(e){showMsg('Export failed: '+e.message,'err');}\n}\nfunction showMsg(text,type){const el=document.createElement('div');el.className='status-msg mono '+type;el.textContent=text;document.body.appendChild(el);setTimeout(()=>el.remove(),3000);}\nfetchStats();fetchSessions();\n</script>\n</body></html>"

SESSION_COLS = """
    session_id, classification, verified_class,
    start_system_name, start_region, end_system_name, end_region,
    systems_visited, system_path,
    start_time, end_time, duration_minutes, day_of_week, hour_of_day,
    kill_count, pod_kills, total_value, avg_value_per_kill, max_probability,
    member_ids, member_count, corp_ids, corp_count, alliance_ids, alliance_count,
    ship_composition, victim_types, stargate_name, kill_ids
"""


# ─── DB helpers ─────────────────────────────────────────────────────────────


def _row_to_dict(row) -> dict:
    d = {}
    for k, v in dict(row).items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


# ─── Web Server ─────────────────────────────────────────────────────────────


async def create_app(db_url: str, port: int):
    print("  Connecting to database...", flush=True)
    try:
        pool = await asyncpg.create_pool(db_url, min_size=1, max_size=5, ssl=False)
        async with pool.acquire() as conn:
            count = await conn.fetchval("SELECT COUNT(*) FROM activity_sessions")
        print(f"  Connected - {count} sessions in DB", flush=True)
    except Exception as e:
        print(f"\n  ERROR: Cannot connect to database: {e}")
        print("  Check your --db connection string and that the SSH tunnel is running.")
        sys.exit(1)

    # ── Schema migration: add any columns the old DB may be missing ──────
    print("  Checking schema...", flush=True)
    # Only add verified_class — the sole output of annotation, needed for ML training.
    # All other columns already exist in the schema written by server.py.
    migrations = [
        "ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS verified_class TEXT",
    ]
    async with pool.acquire() as conn:
        for sql in migrations:
            try:
                await conn.execute(sql)
            except Exception as e:
                print(f"  Migration warning: {e}", flush=True)
    print("  Schema OK", flush=True)

    app = web.Application()

    async def index(request):
        return web.Response(text=HTML, content_type="text/html")

    async def api_stats(request):
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT
                    COUNT(*)                                                AS total_sessions,
                    COUNT(*) FILTER (WHERE verified_class IS NOT NULL)     AS annotated,
                    COUNT(*) FILTER (WHERE verified_class IS NULL)         AS pending,
                    COUNT(*) FILTER (WHERE verified_class IS NOT NULL
                                      AND verified_class != classification) AS corrections,
                    0 AS splits
                FROM activity_sessions
            """)
        return web.json_response(dict(row))

    async def api_pending(request):
        limit = int(request.rel_url.query.get("limit", "100"))
        offset = int(request.rel_url.query.get("offset", "0"))
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {SESSION_COLS}
                FROM activity_sessions
                WHERE verified_class IS NULL
                ORDER BY start_time DESC
                LIMIT $1 OFFSET $2
            """,
                limit,
                offset,
            )
        return web.json_response([_row_to_dict(r) for r in rows])

    async def api_all(request):
        limit = int(request.rel_url.query.get("limit", "200"))
        offset = int(request.rel_url.query.get("offset", "0"))
        annotated_only = (
            request.rel_url.query.get("annotated_only", "false").lower() == "true"
        )
        where = "WHERE verified_class IS NOT NULL" if annotated_only else ""
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {SESSION_COLS}
                FROM activity_sessions
                {where}
                ORDER BY start_time DESC
                LIMIT $1 OFFSET $2
            """,
                limit,
                offset,
            )
        return web.json_response([_row_to_dict(r) for r in rows])

    async def api_verify(request):
        session_id = request.match_info["session_id"]
        body = await request.json()
        verified = body.get("verified_class")
        note = body.get("note", "")
        if not verified:
            return web.json_response(
                {"error": "verified_class is required"}, status=400
            )
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE activity_sessions
                SET verified_class = $1
                WHERE session_id = $2
            """,
                verified,
                session_id,
            )
            await conn.execute(
                """
                UPDATE player_activity SET classification = $1 WHERE session_id = $2
            """,
                verified,
                session_id,
            )
        return web.json_response(
            {"ok": True, "session_id": session_id, "verified_class": verified}
        )

    async def api_split(request):
        # split_points column not present in this DB version — silently accepted
        session_id = request.match_info["session_id"]
        return web.json_response({"ok": True, "session_id": session_id})

    async def api_export(request):
        async with pool.acquire() as conn:
            sessions = await conn.fetch("""
                SELECT s.*,
                       array_agg(DISTINCT t.from_class || '->' || t.to_class)
                           FILTER (WHERE t.id IS NOT NULL) AS transition_labels
                FROM activity_sessions s
                LEFT JOIN session_transitions t ON t.session_id = s.session_id
                WHERE s.verified_class IS NOT NULL
                GROUP BY s.id
                ORDER BY s.start_time
            """)
            players = await conn.fetch("""
                SELECT pa.*
                FROM player_activity pa
                JOIN activity_sessions s ON s.session_id = pa.session_id
                WHERE s.verified_class IS NOT NULL
                ORDER BY pa.start_time
            """)
        return web.json_response(
            {
                "sessions": [_row_to_dict(r) for r in sessions],
                "player_activities": [_row_to_dict(r) for r in players],
                "export_time": datetime.now(timezone.utc).isoformat(),
                "total_annotated": len(sessions),
            }
        )

    app.router.add_get("/", index)
    app.router.add_get("/api/annotations/stats", api_stats)
    app.router.add_get("/api/annotations/pending", api_pending)
    app.router.add_get("/api/annotations/all", api_all)
    app.router.add_post("/api/annotations/{session_id}/verify", api_verify)
    app.router.add_post("/api/annotations/{session_id}/split", api_split)
    app.router.add_get("/api/annotations/export", api_export)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", port)
    await site.start()
    print(f"\n  zKill Annotator running at http://localhost:{port}")
    print(f"  Press Ctrl+C to stop\n")

    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await pool.close()
        await runner.cleanup()


# ─── Entrypoint ─────────────────────────────────────────────────────────────


def _load_env(path: str) -> dict:
    """Load a .env file and return key/value pairs."""
    import pathlib

    env = {}
    p = pathlib.Path(path)
    if not p.exists():
        return env
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip()
    return env


def main():
    # Default .env location: backend/.env relative to this script, or CWD
    import os
    import pathlib

    script_dir = pathlib.Path(__file__).parent
    default_env = str(script_dir.parent / "backend" / ".env")

    parser = argparse.ArgumentParser(description="zKill Activity Annotator")
    parser.add_argument("--env", default=default_env, help="Path to .env file")
    parser.add_argument("--db", default=None, help="Override DATABASE_URL")
    parser.add_argument(
        "--port", type=int, default=None, help="Override UI port (default 9090)"
    )
    args = parser.parse_args()

    env = _load_env(args.env)
    if env:
        print(f"  Loaded .env from {args.env}")
    else:
        print(f"  No .env found at {args.env}, using defaults / --db arg")

    # Priority: CLI arg > .env > fallback
    db_url = (
        args.db
        or env.get("DATABASE_URL")
        or "postgres://postgres:postgres@localhost:5432/postgres"
    )
    port = args.port or 9090

    # asyncpg doesn't understand ?sslmode=... — strip it and pass ssl=False
    if "sslmode=" in db_url:
        import re

        db_url = re.sub(r"[?&]sslmode=[^&]*", "", db_url).rstrip("?&")

    print("  Starting annotator...")
    asyncio.run(create_app(db_url, port))


if __name__ == "__main__":
    main()

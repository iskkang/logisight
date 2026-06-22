# 지구본 v2 — 철도·결빙·events 렌더 통합 가이드

v1 데이터 로더(`globe-data.js`)는 이미 v2용으로 갱신됨 (단일 `ASSETS`, `EVENTS` 로드, `selEvent`/`eventHit` 상태 추가).
이 문서는 **호스트 프로토타입 함수 편집**(렌더/인터랙션) 스니펫이다 — 독립 파일이 아니라 기존 함수에 끼워넣는 조각이라 별도 `.js`로 두지 않는다.

> 참고: 이벤트 핀 스니펫이 쓰는 `hexrgb(col)`(hex→"r,g,b") 헬퍼가 호스트에 없으면 아래를 한 번 추가:
> ```js
> function hexrgb(h){ h=h.replace('#',''); var n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255].join(','); }
> ```

## (a) loadData — 완료됨 (globe-data.js)
`ASSETS`/`EVENTS` 구성은 `globe-data.js`에 반영됨. 추가 작업 없음.

## (b) render() — 통합 ASSETS + 철도(■)·결빙항만(링) + events 핀
`node()` 함수의 분기를 아래로 교체:
```js
function node(n){
  if(!visible(n.lon,n.lat)) return; var p=projection([n.lon,n.lat]); if(!p) return;
  var r=assetRisk(n),c=level(r),col=rc(c),sel=(selAsset===n.key);
  if(n.type==='choke'){ var s=sel?8:6; ctx.beginPath(); ctx.moveTo(p[0],p[1]-s); ctx.lineTo(p[0]+s,p[1]); ctx.lineTo(p[0],p[1]+s); ctx.lineTo(p[0]-s,p[1]); ctx.closePath();
    ctx.fillStyle=col; ctx.fill(); ctx.lineWidth=1.3; ctx.strokeStyle='rgba(7,15,28,.8)'; ctx.stroke();
    ctx.fillStyle='rgba(234,242,251,.92)'; ctx.font='600 10px JetBrains Mono, monospace'; ctx.textAlign='center'; ctx.fillText(n.name,p[0],p[1]-11);
  } else if(n.type==='rail'){ var sq=sel?5:3.6; ctx.beginPath(); ctx.rect(p[0]-sq,p[1]-sq,2*sq,2*sq);
    ctx.fillStyle=col; ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='rgba(7,15,28,.7)'; ctx.stroke();
    if(sel){ ctx.fillStyle='rgba(234,242,251,.92)'; ctx.font='600 10px JetBrains Mono, monospace'; ctx.textAlign='center'; ctx.fillText(n.name,p[0],p[1]-9); }
  } else { ctx.beginPath(); ctx.arc(p[0],p[1],sel?5:3.4,0,7); ctx.fillStyle=col; ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='rgba(7,15,28,.7)'; ctx.stroke();
    if(n.freeze_prone){ ctx.beginPath(); ctx.arc(p[0],p[1],sel?7.5:5.5,0,7); ctx.lineWidth=1; ctx.strokeStyle='rgba(186,230,253,0.8)'; ctx.stroke(); } // 결빙 항만 표시(하늘색 링)
    if(sel){ ctx.fillStyle='rgba(234,242,251,.92)'; ctx.font='600 10px JetBrains Mono, monospace'; ctx.textAlign='center'; ctx.fillText(n.name,p[0],p[1]-9); }
  }
  assetHit.push({key:n.key,x:p[0],y:p[1],r:n.type==='choke'?11:8});
}
```
자산 루프 교체 (기존 `PORTS.forEach(...); CHOKES.forEach(...)` 두 줄을):
```js
assetHit=[]; ASSETS.forEach(function(n){ node(n); });
```
SPOTS 루프 다음에 events 핀 추가:
```js
// 글로벌 감지 이벤트 핀
eventHit=[];
EVENTS.forEach(function(e){
  if(e.lon==null||e.lat==null||!visible(e.lon,e.lat)) return; var p=projection([e.lon,e.lat]); if(!p) return;
  var col=e.severity==='r'?'#EF4444':'#F59E0B', base=e.severity==='r'?11:8, pulse=reduce?0.6:(0.5+0.5*Math.sin(performance.now()/520+e.lon));
  ctx.beginPath(); ctx.arc(p[0],p[1],base+pulse*10,0,7); ctx.fillStyle='rgba('+hexrgb(col)+',0.10)'; ctx.fill();
  ctx.beginPath(); ctx.arc(p[0],p[1],base,0,7); ctx.fillStyle='rgba('+hexrgb(col)+',0.55)'; ctx.fill();
  ctx.lineWidth=1.6; ctx.strokeStyle='rgba('+hexrgb(col)+',0.95)'; ctx.stroke();
  var k={cyclone:'태풍',storm:'폭풍',flood:'홍수',snow:'폭설',other:'경보'}[e.kind]||'경보';
  ctx.fillStyle='rgba(234,242,251,.92)'; ctx.font='600 10px JetBrains Mono, monospace'; ctx.textAlign='center'; ctx.fillText(k,p[0],p[1]-base-7);
  eventHit.push({id:e.id,x:p[0],y:p[1],r:base+8});
});
```

## (c) 요약·알림을 ASSETS + events 기반으로
`render2()` 안의 `all = PORTS.map(...).concat(...)` → `var all = ASSETS;`.
`nearSpot(...)` 흔적은 `assetDriver(n)`로 대체(v1에서 이미 정리됐으면 그대로).

`render2()` if-체인 맨 앞에 이벤트 상세 분기 추가:
```js
if(selEvent){ var e=EVENTS.filter(function(x){return x.id===selEvent;})[0];
  body.innerHTML='<div class="ptag">감지된 이벤트 · '+e.source.toUpperCase()+'</div><div class="detail"><div class="dh"><div class="dname">'+e.title+'</div><span class="pill '+e.severity+'">'+(e.severity==='r'?'경보':'주의')+'</span></div>'+
    '<div class="drv"><span>지역</span> '+(e.area||'—')+'</div>'+
    (e.url?'<div class="drv"><a href="'+e.url+'" target="_blank" rel="noopener" style="color:var(--solar)">출처 보기 ↗</a></div>':'')+'</div>';
} else if(selSpot){ /* 기존 */ }
```

`renderAlerts()` 교체 (자산 + 이벤트 병합):
```js
function renderAlerts(){
  var box=document.getElementById('alerts');
  var aa = ASSETS.filter(function(n){return level(assetRisk(n))!=='g';}).map(function(n){ var c=level(assetRisk(n));
    var ty=n.type==='choke'?'초크포인트':n.type==='rail'?'철도':'항만';
    return {sev:c, score:assetRisk(n), txt:'<b>'+n.name+' ('+ty+')</b> · '+assetDriver(n)+' · '+(hIdx>0?HLBL[hIdx]+' ':'')+'리스크 '+assetRisk(n)}; });
  var ee = EVENTS.map(function(e){ return {sev:e.severity, score:e.severity==='r'?95:55, txt:'<b>'+e.title+'</b> · '+(e.area||'')+' · '+e.source.toUpperCase()}; });
  var all = aa.concat(ee).sort(function(x,y){return y.score-x.score;}).slice(0,4);
  if(!all.length){ box.innerHTML='<div class="clear">현재 경보·주의 없음 — 전 세계 정상</div>'; return; }
  box.innerHTML=all.map(function(al){ var warn=al.sev==='a'; return '<div class="alert'+(warn?' warn':'')+'"><span class="sev">'+(warn?'주의':'경보')+'</span><span class="tx">'+al.txt+'</span></div>'; }).join('');
}
```

## (d) 선택 초기화 + 이벤트 히트 검사
asset/route/spot/빈 곳 클릭, 리스트 클릭, 시점 탭 핸들러 각각에 `selEvent=null;`을 함께 넣는다.
`hitTest()` 맨 앞에 이벤트 히트 검사 추가 (이벤트가 자산보다 우선):
```js
for(var i=0;i<eventHit.length;i++){ var ev=eventHit[i]; if(Math.hypot(px-ev.x,py-ev.y)<=ev.r){ selEvent=ev.id; selAsset=null; selSpot=null; sync(); return; } }
```

## (e) 범례 보강
한 줄: 항만(원)·초크포인트(◆)·철도(■), 결빙항만(하늘색 링), 이벤트(맥동 핀).

---

## 검증 (spec §5 — risk-refresh / event-ingest 수동 1회 실행 후)
```sql
-- 겨울이면 폭설/한파/결빙 driver 확인
select asset_id, horizon_days, score, level, driver from public.asset_risk
 where asset_id in ('osh','khorgos','stpetersburg','vladivostok') order by asset_id, horizon_days;
-- 피드 적재 확인
select source, count(*) from public.events group by source;
```
지구본: 철도 사각형·결빙항만 하늘색 링이 보이고, 겨울이면 중앙아 철도가 폭설로·발트/극동 항만이 결빙으로 색칠. 활성 허리케인/재해가 있으면 해당 지역에 이벤트 핀+알람 등장.

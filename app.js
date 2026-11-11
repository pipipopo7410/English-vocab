/* 單字日課 v3 — 純前端學習引擎 + 可選 Supabase 雲端帳號 */
(()=>{'use strict';
const EXAM='2027-05-15', FINAL_STUDY='2027-05-14', GOALS=[15,30,50], GOAL_NAMES={15:'輕量組・浮動',30:'標準組',50:'考前衝刺組'};
const ROOT=document.getElementById('view-root');
let WORDS=[],WORDS_BY_ID=new Map(),supabase=null,cloudUser=null,view='home',cloudReady=false,syncStatus='local',pendingSync=false,syncTimer=null,installPrompt=null,stateRevision=0;
let localKey='vocab-daily-v3:guest',S=emptyState(),activeWordId=null,activeMode='e2c',answered=false,lastCorrect=false;
let calendarCursor='',libraryPage=0,libraryQuery='',libraryLevel='all',currentClass=null,teacherClasses=[];
let syncChain=Promise.resolve(),toastTimer=null,advanceTimer=null,libraryTopic='all';
function mobileMode(){return window.matchMedia('(max-width: 830px)').matches;}
function closeMobileMenu(){const nav=document.querySelector('.side-nav'),t=document.getElementById('mobile-menu-toggle');if(!nav||!t)return;nav.classList.remove('open');t.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');}
function toggleMobileMenu(){const nav=document.querySelector('.side-nav'),t=document.getElementById('mobile-menu-toggle');if(!nav||!t||!mobileMode())return;const open=nav.classList.toggle('open');t.setAttribute('aria-expanded',open?'true':'false');document.body.classList.toggle('menu-open',open);}
async function loadWordsData(){try{if(location.protocol!=='file:'){const resp=await fetch('word-data-full.json');if(!resp.ok)throw new Error('無法讀取字庫');return await resp.json();}}catch(e){console.warn('json fetch failed, fallback to embedded data',e.message);}
 if(Array.isArray(window.WORD_DATA)&&window.WORD_DATA.length)return window.WORD_DATA;
 throw new Error(location.protocol==='file:'?'本機直接開啟時找不到內建字庫，請確認同資料夾內包含 word-data-full.js。':'無法讀取字庫檔案。');}
const TOPICS=['人物與家庭','校園與學習','飲食與購物','自然與動物','交通與旅行','身體與健康','情緒與特質','時間與數量','活動與運動','居家與用品','語言與表達','社會與科技'];
const THEME_MAP={
 '能力與特質':'情緒與特質','情緒與感受':'情緒與特質','人物與職業':'人物與家庭',
 '學校與學習':'校園與學習','食物與飲料':'飲食與購物','自然環境':'自然與動物','動物與昆蟲':'自然與動物',
 '交通工具':'交通與旅行','位置與方位':'交通與旅行','地點與場所':'交通與旅行',
 '身體部位':'身體與健康','健康與醫療':'身體與健康','時間與數字':'時間與數量',
 '休閒與娛樂':'活動與運動','動作與行為':'活動與運動',
 '生活環境':'居家與用品','生活用品':'居家與用品','衣物與飾品':'居家與用品',
 '代名詞':'語言與表達','介系詞/連接詞':'語言與表達','抽象概念與其他':'語言與表達',
 '顏色':'情緒與特質'
};
function groupOf(w){if(w.study_topic)return w.study_topic;
 if(w.theme && w.theme!=='官方增補')return THEME_MAP[w.theme]||'語言與表達';
 return '語言與表達';
}
function lightMetrics(){const remaining=unseenCount();const days=Math.max(1,diffDays(today(),FINAL_STUDY)+1);
 const dailyNew=remaining===0?0:Math.ceil(remaining/days);
 const due=dueCount();
 // 只要求當日的一部分到期複習，避免中斷一天後造成任務無限膨脹。
 const reviews=Math.min(due, Math.max(5,Math.ceil(Math.max(1,dailyNew)*.7)));
 const planned=Math.min(WORDS.length,Math.max(1,dailyNew+reviews));
 return {dailyNew,days,due,reviews,planned,remaining};
}
function dayGoal(d){return d?.goal|| (S.settings.goal===15?lightMetrics().planned:S.settings.goal);}
function goalLabel(d){if(d?.kind==='review')return '再練一次';if(d?.kind==='preview')return '預習新單字';const mode=d?.mode||S.settings.goal;return GOAL_NAMES[mode]||'每日任務';}
function chooseUnseen(count,already){const groups=TOPICS.map(topic=>({topic,arr:WORDS.filter(w=>!everLearned(w)&&!already.has(w.id)&&groupOf(w)===topic)})).filter(g=>g.arr.length);
 // 主題情境輪替，不把同義或同類詞一整排塞在一起。
 groups.sort((a,b)=>(hashId(today()+'|'+a.topic)%997)-(hashId(today()+'|'+b.topic)%997));
 for(const g of groups)g.arr.sort((a,b)=>a.level===b.level?((hashId(today()+'|'+a.id)>>>0)-(hashId(today()+'|'+b.id)>>>0)):(a.level==='basic'?-1:1));
 const selected=[];const main=groups.slice(0,Math.min(4,groups.length));let rounds=0;
 while(selected.length<count&&rounds<count+1&&main.some(g=>g.arr.length)){
   for(const g of main){const w=g.arr.shift();if(w){selected.push(w.id);already.add(w.id);if(selected.length>=count)break;}}
   rounds++;
 }
 const rest=groups.flatMap(g=>g.arr).filter(w=>!already.has(w.id)).sort((a,b)=>{
   if(a.level!==b.level)return a.level==='basic'?-1:1;
   return (hashId(today()+'|'+a.id)>>>0)-(hashId(today()+'|'+b.id)>>>0);
 });
 for(const w of rest){if(selected.length>=count)break;selected.push(w.id);already.add(w.id);}
 return selected;
}

function emptyState(){return {settings:{goal:30,nickname:'本機使用者',voiceRate:0.86},progress:{},days:{},extraSession:null,updatedAt:null};}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dateTaipei(d=new Date()){const obj=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${obj.year}-${obj.month}-${obj.day}`;}
function addDays(date,number){const d=new Date(`${date}T12:00:00+08:00`);d.setUTCDate(d.getUTCDate()+number);return dateTaipei(d);}
function diffDays(a,b){return Math.round((Date.parse(b+'T12:00:00+08:00')-Date.parse(a+'T12:00:00+08:00'))/86400000);}
function formatDay(day){return day.replaceAll('-','/');}
function today(){return dateTaipei();}
function yesterday(){return addDays(today(),-1);}
function notify(msg){const t=document.getElementById('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,4200);}
function loadLocal(k){try{const d=JSON.parse(localStorage.getItem(k));if(d && d.settings && d.progress && d.days)return {...emptyState(),...d};}catch(e){}return emptyState();}
function updateSyncTag(){const el=document.getElementById('connect-tag');if(!el)return;
 const label={local:'本機記錄',pending:'待備份',synced:'☁ 已備份',error:'⚠ 備份失敗'};
 el.textContent=cloudUser?(label[syncStatus]||'帳號已登入'):(localKey!=='vocab-daily-v3:guest'?'離線・待登入':'本機記錄');el.title=cloudUser?'進度保存於本機與帳號雲端':(localKey!=='vocab-daily-v3:guest'?'正在使用此裝置最近登入帳號的本機快取，登入並同步後才有雲端備份':'未登入時，進度僅保存於此裝置');
 const note=document.getElementById('sync-indicator');if(note)note.textContent=cloudUser?(label[syncStatus]||'帳號已登入'):(localKey!=='vocab-daily-v3:guest'?'待重新登入並同步':'尚未登入 · 僅本機保存');
}
function persist(){stateRevision+=1;S.updatedAt=new Date().toISOString();localStorage.setItem(localKey,JSON.stringify(S));if(cloudUser&&cloudReady){pendingSync=true;syncStatus='pending';updateSyncTag();queueProgressSync();}}
// 將相同帳號在不同裝置的字詞紀錄與已完成日期保留；同一日期同字詞取較新的作答紀錄。
function latestStamp(obj){return obj?.entryUpdatedAt||obj?.lastAttempt||obj?.lastSuccess||'';}
function mergeStates(a,b){if(!a||!a.settings||!a.progress||!a.days)return {...emptyState(),...b};if(!b||!b.settings||!b.progress||!b.days)return {...emptyState(),...a};
 const newer=(a.updatedAt||'')>=(b.updatedAt||'')?a:b,other=newer===a?b:a;
 const merged={...emptyState(),...newer,settings:{...emptyState().settings,...newer.settings},progress:{},days:{}};
 for(const id of new Set([...Object.keys(a.progress),...Object.keys(b.progress)])){
  const x=a.progress[id],y=b.progress[id];if(!WORDS_BY_ID.has(id))continue;
  if(!x||!y)merged.progress[id]=x||y;
  else {const primary=latestStamp(x)>=latestStamp(y)?x:y,secondary=primary===x?y:x;
   merged.progress[id]={...primary,successDays:Math.max(x.successDays||0,y.successDays||0)};
   if((secondary.lastSuccess||'')>(primary.lastSuccess||''))merged.progress[id].lastSuccess=secondary.lastSuccess;
  }
 }
 for(const date of new Set([...Object.keys(a.days),...Object.keys(b.days)])){
  const x=a.days[date],y=b.days[date];if(!x||!y){merged.days[date]=x||y;continue;}
  const best=(x.finished!==y.finished)?(x.finished?x:y):((x.passed?.length||0)>=(y.passed?.length||0)?x:y);
  merged.days[date]=best;
 }
 const exA=a.extraSession,exB=b.extraSession;
 merged.extraSession=(!exA||!exB)?(exA||exB||null):(exA.startedAt>=exB.startedAt?exA:exB);
 merged.updatedAt=newer.updatedAt||other.updatedAt||null;return merged;
}
function queueProgressSync(){if(!cloudUser||!cloudReady||!supabase)return;
 clearTimeout(syncTimer);syncTimer=setTimeout(()=>{syncTimer=null;flushCloudBackup();},900);
}
function flushCloudBackup(){if(!cloudUser||!cloudReady||!supabase)return Promise.resolve(false);
 const userId=cloudUser.id;
 syncChain=syncChain.then(async()=>{
  if(!cloudUser||cloudUser.id!==userId||!cloudReady)return false;
  if(!pendingSync)return true;
  try{const response=await supabase.from('student_progress').select('payload').eq('user_id',userId).maybeSingle();
   if(response.error)throw response.error;
   const beginRevision=stateRevision;const merged=mergeStates(S,response.data?.payload);merged.updatedAt=new Date().toISOString();
   const {error}=await supabase.from('student_progress').upsert({user_id:userId,payload:merged,updated_at:merged.updatedAt},{onConflict:'user_id'});
   if(error)throw error;
   if(cloudUser?.id!==userId)return false;
   S=mergeStates(S,merged);localStorage.setItem(localKey,JSON.stringify(S));
   pendingSync=stateRevision!==beginRevision;syncStatus=pendingSync?'pending':'synced';updateSyncTag();if(pendingSync)queueProgressSync();return true;
  }catch(e){console.warn('Cloud backup failed',e);pendingSync=true;syncStatus='error';updateSyncTag();return false;}
 });return syncChain;
}
async function syncProfile(){if(!cloudUser||!supabase)return;const {error}=await supabase.from('profiles').upsert({user_id:cloudUser.id,nickname:S.settings.nickname.slice(0,40)},{onConflict:'user_id'});if(error)console.warn('Profile sync failed',error.message);}
function sessionToday(){return S.days[today()]||null;}
function profile(word){return S.progress[word.id]||null;}
function everLearned(w){const p=profile(w);return !!(p&&(p.lastSuccess||p.successDays>0));}
function unseenCount(){return WORDS.filter(w=>!everLearned(w)).length;}
function dueCount(){return WORDS.filter(w=>{const p=profile(w);return p && p.lastSuccess && p.nextDue<=today();}).length;}
function matureCount(){return WORDS.filter(w=>{const p=profile(w);return p && p.stage>=4 && p.successDays>=3;}).length;}
function dateProjection(){
 const remaining=unseenCount(), light=S.settings.goal===15;
 if(light)return {days:Math.max(0,diffDays(today(),FINAL_STUDY)+1),estimatedNew:lightMetrics().dailyNew,date:remaining?FINAL_STUDY:today(),remaining};
 const estimatedNew=Math.max(1,Math.floor(S.settings.goal*.5));const days=Math.ceil(remaining/estimatedNew);
 return {days,estimatedNew,date:addDays(today(),Math.max(0,days-1)),remaining};
}
function hero(){const left=Math.max(0,diffDays(today(),EXAM));return `<section class="hero"><div><div class="eyebrow">會考單字 · 每天一點</div><h1>今天的進度，從這裡開始 ☀️</h1></div><div class="hero-date"><small>距會考還有</small><b>${left} 天</b><small>5 / 15–16</small></div></section>`;}
function goalButtons(){const current=S.settings.goal,locked=!!sessionToday(),m=lightMetrics();return `<div class="goal-grid">
 <button class="goal-btn ${current===15?'selected':''}" data-goal="15" aria-pressed="${current===15}"><span class="goal-name">🌱 輕量組</span><b>${m.planned}<small> 個／今天</small></b><span>新 ${m.dailyNew} ＋複習 ${m.reviews}</span></button>
 <button class="goal-btn ${current===30?'selected':''}" data-goal="30" aria-pressed="${current===30}"><span class="goal-name">✨ 標準組</span><b>30<small> 個／天</small></b><span>固定配額</span></button>
 <button class="goal-btn ${current===50?'selected':''}" data-goal="50" aria-pressed="${current===50}"><span class="goal-name">🚀 考前衝刺</span><b>50<small> 個／天</small></b><span>固定配額</span></button></div>${locked?'<p class="help">今日任務已開始，切換組別從明天生效。</p>':''}`;}

function progressBar(done,total){return `<div class="progress-track"><div style="width:${total?Math.min(100,done/total*100):0}%"></div></div><div class="progress-meta"><span>${done} / ${total} 詞目</span><span>${total?Math.round(done/total*100):0}%</span></div>`;}
function renderHome(){const day=sessionToday(),g=dayGoal(day),passed=day?.passed?.length||0,projection=dateProjection(),finish=day?.finished,m=lightMetrics(),extra=S.extraSession?.day===today()&&!S.extraSession.finished?S.extraSession:null;
 ROOT.innerHTML=hero()+`<section class="panel home-task"><div class="section-head"><div><h2>🎯 今日任務</h2><p>${goalLabel(day)} · ${g} 個</p></div><span class="pill ${finish?'good':''}">${finish?(day.cloudConfirmedAt?'☑ 已完成':'✓ 已完成'):(day?'進行中':'未開始')}</span></div>${progressBar(passed,g)}<button id="start-study" class="button wide big-action">${finish?'查看完成紀錄':day?'繼續複習 →':'開始今日練習 →'}</button>${finish?`<div class="extra-actions"><button id="extra-review-home" class="extra-btn review">🔁 再練一次</button><button id="extra-preview-home" class="extra-btn preview" ${unseenCount()===0?'disabled':''}>🚀 預習明天</button></div>${extra?`<button id="extra-resume-home" class="button outline wide" style="margin-top:10px">繼續${extra.kind==='review'?'複習':'預習'} · ${extra.passed.length}/${extra.goal}</button>`:''}`:''}</section>`+
 `<section class="panel"><div class="section-head"><div><h2>📆 每日學習量</h2><p>輕量組會每天重新計算</p></div></div>${goalButtons()}</section>`+
 `<div class="cards"><div class="stat-card accent-blue"><div class="label">首次答對</div><strong>${WORDS.length-unseenCount()}</strong><small>／${WORDS.length}</small></div><div class="stat-card accent-mint"><div class="label">待複習</div><strong>${dueCount()}</strong></div><div class="stat-card accent-peach"><div class="label">已熟練</div><strong>${matureCount()}</strong></div></div>`+
 `<section class="panel small-summary"><div class="section-head"><div><h2>🏁 首輪預估</h2></div><strong class="big-date">${formatDay(projection.date)}</strong></div><p class="muted small">剩下 ${projection.remaining} 個尚未首次答對的字${S.settings.goal===15?` · ${m.dailyNew} 個新字／天`:''}</p></section>`;
 ROOT.querySelector('#start-study').addEventListener('click',()=>finish?showFinished(day):startStudy());ROOT.querySelectorAll('[data-goal]').forEach(b=>b.addEventListener('click',()=>setGoal(+b.dataset.goal)));
 if(finish){ROOT.querySelector('#extra-review-home').onclick=()=>startExtra('review');ROOT.querySelector('#extra-preview-home').onclick=()=>startExtra('preview');if(extra)ROOT.querySelector('#extra-resume-home').onclick=()=>renderQuiz(true);}
}
function setGoal(goal){if(!GOALS.includes(goal))return;S.settings.goal=goal;persist();renderHome();notify(`已設定「${GOAL_NAMES[goal]}」${goal} 個／天${sessionToday()?'，明天起使用新設定':''}`);}
function startPlan(mode){
 const chosen=[],selected=new Set(),due=WORDS.filter(w=>{const p=profile(w);return p&&p.lastSuccess&&p.nextDue<=today();}).sort((a,b)=>{
  const x=S.progress[a.id],y=S.progress[b.id];return x.nextDue.localeCompare(y.nextDue)||(x.stage-y.stage)||a.word.localeCompare(b.word);
 });
 let planned;
 if(mode===15){const m=lightMetrics();
  for(const w of due.slice(0,m.reviews)){selected.add(w.id);chosen.push(w.id);}
  chosen.push(...chooseUnseen(m.dailyNew,selected));
  planned=Math.max(1,chosen.length);
 }else{
  planned=mode;
  const reviewBudget=Math.min(due.length,Math.floor(planned*.5));
  for(const w of due.slice(0,reviewBudget)){selected.add(w.id);chosen.push(w.id);}
  chosen.push(...chooseUnseen(Math.max(0,planned-chosen.length),selected));
 }
 // 字庫全部接觸後仍可每天複習；補足不足額時以最久未練的詞優先。
 if(chosen.length<planned){const rest=WORDS.filter(w=>!selected.has(w.id)).sort((a,b)=>
  (profile(a)?.nextDue||'').localeCompare(profile(b)?.nextDue||'')||(hashId(today()+a.id)-hashId(today()+b.id)));
  for(const w of rest){if(chosen.length>=planned)break;chosen.push(w.id);selected.add(w.id);}
 }
 const goal=chosen.length;
 return {mode,goal,plan:chosen,queue:[...chosen],passed:[],fails:{},startedAt:new Date().toISOString(),finished:false,finishedAt:null,cloudConfirmedAt:null,cloudSyncedPasses:[]};
}
async function startStudy(){let d=sessionToday();if(!d){d=startPlan(S.settings.goal);S.days[today()]=d;persist();}if(d.finished){showFinished(d);return;} renderQuiz();}
function hashId(str){let h=2166136261;for(const c of str){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;}
// 彈性練習只更新詞彙熟練度與首輪進度，不新增隔日的完成簽到。
function extraQuota(kind){if(kind==='review')return sessionToday()?.plan?.length||0;
 if(S.settings.goal===15){const daysLeft=Math.max(1,diffDays(today(),FINAL_STUDY));return Math.min(unseenCount(),Math.max(1,Math.ceil(unseenCount()/daysLeft)));}
 return Math.min(unseenCount(),S.settings.goal);
}
function startExtra(kind){const todayDay=sessionToday();if(!todayDay?.finished){notify('先完成今天的任務，再自由加練。');return;}
 let plan=[];if(kind==='review'){plan=shuffle([...(todayDay.plan||todayDay.passed||[])]);}else if(kind==='preview'){
  const quota=extraQuota(kind);plan=chooseUnseen(quota,new Set());
 }else return;
 if(!plan.length){notify(kind==='preview'?'字庫都已接觸過了，可以選擇再練一次。':'今天尚無可複習的單字。');return;}
 S.extraSession={kind,day:today(),goal:plan.length,plan:[...plan],queue:[...plan],passed:[],fails:{},startedAt:new Date().toISOString(),finished:false,finishedAt:null};persist();renderQuiz(true);
}
function finishExtra(d){if(!d.finished){d.finished=true;d.finishedAt=new Date().toISOString();persist();}}
function showExtraFinished(d){showView('extra-finished');ROOT.innerHTML=`<section class="panel center success-panel"><div class="success-icon">${d.kind==='review'?'🔁':'🚀'}</div><h1>${d.kind==='review'?'複習完成！':'預習完成！'}</h1><p>這一輪練習了 <b>${d.passed.length}</b> 個詞目。</p><span class="pill good">今日任務已完成</span><div class="actions" style="justify-content:center"><button id="extra-again" class="button">${d.kind==='review'?'再練一次':'繼續預習'}</button><button class="button secondary" data-view="home">回首頁</button></div></section>`;
 ROOT.querySelector('#extra-again').onclick=()=>startExtra(d.kind);
 ROOT.querySelector('[data-view="home"]').onclick=()=>showView('home');
}
function questionMode(w,day){const prog=profile(w);if(!prog||prog.stage===0)return 'e2c';
 // 熟字才逐步導入產出性練習；克漏字保留情境，拼寫不顯示答案。
 const mod=hashId(w.id+today())%10;
 if(prog.stage>=4 && mod===0 && w.word.length<=38)return 'spell';
 if(mod===1||mod===2)return 'c2e';
 if(mod===3||mod===4)return 'cloze';
 return 'e2c';
}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
function sentenceFor(w,hide=false){const out=w.sentence.replace('{word}',hide?'______':w.word);return out.replace(/^[a-z]/,c=>c.toUpperCase());}
function cnMain(w){return w.chinese.split(/[／；/]/)[0].trim();}
function distractors(w,mode){const base=WORDS.filter(a=>a.id!==w.id && a.level===w.level && cnMain(a)!==cnMain(w));
 // 相同詞性優先，減少「完全不同類型」的選項；仍排除與目標中文直譯重複者
 const pos=x=>(x.speech||'').split(/[./]/)[0];const mainPos=pos(w);const same=shuffle(base.filter(x=>mainPos&&pos(x)===mainPos));const rest=shuffle(base.filter(x=>!same.includes(x)));const selected=[];const meanings=new Set([cnMain(w)]);
 for(const x of [...same,...rest]){if(mode==='e2c'&&meanings.has(cnMain(x)))continue;if(selected.length>=3)break;selected.push(x);meanings.add(cnMain(x));}return selected;}
function renderQuiz(isExtra=false){view=isExtra?'extra-quiz':'quiz';clearTimeout(advanceTimer);advanceTimer=null;
 const d=isExtra?S.extraSession:sessionToday();if(!d)return showView('home');if(d.queue.length===0){if(isExtra){finishExtra(d);showExtraFinished(d);}else{finishDay(d);showFinished(d);}return;}
 const id=d.queue[0],w=WORDS_BY_ID.get(id);if(!w){d.queue.shift();persist();return renderQuiz(isExtra);}
 activeWordId=id;activeMode=questionMode(w,d);answered=false;const mode=activeMode;
 const choices=shuffle([w,...distractors(w,mode)]);let question='',prompt='';
 if(mode==='e2c'){prompt='選出中文意思';question=w.word;}
 else if(mode==='c2e'){prompt='選出英文單字';question=w.chinese;}
 else if(mode==='spell'){prompt='試著拼出英文';question=w.chinese;}
 else{prompt='用例句找出正確的字';question=w.chinese;}
 const example=sentenceFor(w,mode!=='e2c');
 ROOT.innerHTML=`<div class="quiz-top"><button id="quiz-back" class="button outline">← 返回</button><span class="wordmark">${goalLabel(d)} · ${d.passed.length}/${d.goal}</span></div><section class="quiz-card"><div class="quiz-inline"><b>${d.passed.length} / ${d.goal}</b>${progressBarOnly(d.passed.length,d.goal)}</div><div class="divider"></div><div class="quiz-prompt">${esc(prompt)}</div><div class="quiz-word">${esc(question)}</div><div class="context-example"><div class="example-row"><span class="example-mark">📖 情境例句</span><button id="sound-sentence" type="button" class="listen-btn" aria-label="朗讀情境例句">🔊 聽例句</button></div><p>${esc(example)}</p></div>${mode==='spell'?'<form id="spell-form" class="spell-form"><input id="spell-input" type="text" aria-label="輸入英文拼寫" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="輸入英文" required maxlength="50"><button class="button" type="submit">確認</button></form>':`<div id="options" class="options">${choices.map((option,i)=>`<button class="option" data-opt="${esc(option.id)}"><span class="muted small">${i+1}.</span> ${esc(mode==='e2c'?option.chinese:option.word)}</button>`).join('')}</div>`}<div id="answer-box" hidden></div><div class="quiz-bottom"><button id="sound-btn" class="button secondary" ${mode!=='e2c'?'hidden':''}>🔈 單字發音</button><button id="quiz-next" class="button" hidden>下一題 →</button></div></section>`;
 ROOT.querySelector('#quiz-back').onclick=()=>showView('home');ROOT.querySelector('#sound-btn').onclick=()=>speak(w.word);ROOT.querySelector('#sound-sentence').onclick=()=>speak(sentenceFor(w,mode!=='e2c'&&!answered).replace(/_{3,}/g,' ... '));
 ROOT.querySelectorAll('[data-opt]').forEach(b=>b.addEventListener('click',()=>answer(b.dataset.opt)));
 if(mode==='spell'){ROOT.querySelector('#spell-form').onsubmit=e=>{e.preventDefault();answer(ROOT.querySelector('#spell-input').value);};ROOT.querySelector('#spell-input').focus();}
 ROOT.querySelector('#quiz-next').onclick=()=>{clearTimeout(advanceTimer);if(d.finished){isExtra?showExtraFinished(d):showFinished(d);}else renderQuiz(isExtra);};
}
function progressBarOnly(done,total){return `<div class="progress-track" style="flex:1"><div style="width:${Math.round(done/total*100)}%"></div></div>`;}
function speak(text){if(!('speechSynthesis' in window)||!window.SpeechSynthesisUtterance){notify('此裝置無法使用語音朗讀。');return;}
 try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text));u.lang='en-US';u.rate=Number(S.settings.voiceRate)||0.86;u.pitch=1;
 const voices=window.speechSynthesis.getVoices();const english=voices.find(v=>/^en-US/i.test(v.lang))||voices.find(v=>/^en/i.test(v.lang));if(english)u.voice=english;
 u.onerror=e=>{if(e.error!=='canceled'&&e.error!=='interrupted')notify('語音未能播放，請檢查手機音量或系統英文語音設定。');};
 window.speechSynthesis.speak(u);
 }catch(e){notify('無法播放語音。');console.warn(e);}}
function updateLearning(word,correct,failedBefore){const old=S.progress[word.id]||{stage:0,seenOn:today(),successDays:0,lastSuccess:null};let nextStage=0,days=1,successDays=old.successDays||0;
 if(correct){
  // 同一日反覆答對，不可把 1、3、7 天的間隔一路灌到 90 天。
  nextStage=failedBefore?0:old.lastSuccess===today()?Math.max(0,old.stage):Math.min(7,old.stage+1);
  days=([1,1,3,7,14,30,60,90][nextStage]||90);
  if(old.lastSuccess!==today())successDays+=1;
 }
 S.progress[word.id]={...old,stage:nextStage,nextDue:addDays(today(),days),successDays,lastSuccess:correct?today():old.lastSuccess,lastAttempt:today(),entryUpdatedAt:new Date().toISOString()};}
function answer(chosenId){const isExtra=view==='extra-quiz',d=isExtra?S.extraSession:sessionToday();if(!d||answered)return;const w=WORDS_BY_ID.get(activeWordId);if(!w)return;
 const normalize=s=>String(s||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
 const right=activeMode==='spell'?[w.word,...w.aliases].some(alias=>normalize(alias)===normalize(chosenId)):chosenId===w.id;
 answered=true;lastCorrect=right;
 ROOT.querySelectorAll('[data-opt]').forEach(b=>{b.disabled=true;if(b.dataset.opt===w.id)b.classList.add('correct');if(b.dataset.opt===chosenId&&!right)b.classList.add('wrong');});
 if(activeMode==='spell'){const input=ROOT.querySelector('#spell-input');input.disabled=true;ROOT.querySelector('#spell-form button').disabled=true;input.classList.add(right?'correct-input':'wrong-input');}
 if(right){const hadMistake=!!d.fails[w.id];updateLearning(w,true,hadMistake);d.passed.push(w.id);d.queue.shift();}
 else{updateLearning(w,false,false);d.fails[w.id]=(d.fails[w.id]||0)+1;d.queue.shift();d.queue.splice(Math.min(2,d.queue.length),0,w.id);}
 persist();
 const panel=ROOT.querySelector('#answer-box');panel.hidden=false;panel.className='answer-panel';
 if(right){panel.innerHTML='<b>✓ 答對了！</b>';}else{
  panel.innerHTML=`<b>再記一下 👀</b><p><strong>${esc(w.word)}</strong> · ${esc(w.chinese)}</p><p class="small">${esc(sentenceFor(w))}</p>`;
 }
 const wordSound=ROOT.querySelector('#sound-btn');wordSound.hidden=false;ROOT.querySelector('#sound-sentence').setAttribute('aria-label','朗讀完整例句');const next=ROOT.querySelector('#quiz-next');next.hidden=right;next.textContent=d.queue.length?'下一題 →':(isExtra?'查看練習成果':'查看今日完成');
 ROOT.querySelector('.quiz-inline b').textContent=`${d.passed.length} / ${d.goal}`;
 ROOT.querySelector('.quiz-inline .progress-track>div').style.width=`${d.passed.length/d.goal*100}%`;
 if(d.queue.length===0){if(isExtra)finishExtra(d);else finishDay(d);}
 if(right){advanceTimer=setTimeout(()=>{advanceTimer=null;if(view===(isExtra?'extra-quiz':'quiz')&&(isExtra?S.extraSession===d:sessionToday()===d)){if(d.finished){isExtra?showExtraFinished(d):showFinished(d);}else renderQuiz(isExtra);}},520);}
}
function finishDay(d){if(!d.finished){d.finished=true;d.finishedAt=new Date().toISOString();persist();}}
function showFinished(d,studyDate=today()){const isToday=studyDate===today();showView('finished');ROOT.innerHTML=`<section class="panel center success-panel"><div class="receipt-card" id="receipt-card"><div class="receipt-symbol">✓</div><div class="receipt-kicker">單字日課 · 學習完成</div><h1>任務完成！</h1><div class="receipt-user">${esc(S.settings.nickname||'學習者')}</div><div class="receipt-date">${formatDay(studyDate)} <span>台灣時間</span></div><div class="receipt-number">${d.passed.length}<small> / ${d.goal} 個</small></div><div class="receipt-bottom">🌟 每天累積一點點</div></div><p class="receipt-tip">📸 截圖完成卡，傳給老師</p><div class="sync-small" id="sync-indicator">${cloudUser?'雲端備份狀態：'+syncStatus:'尚未登入 · 僅本機保存'}</div>${isToday?`<div class="extra-actions"><button id="extra-review" class="extra-btn review">🔁 再練一次</button><button id="extra-preview" class="extra-btn preview" ${unseenCount()===0?'disabled':''}>🚀 預習明天</button></div>`:''}<div class="actions" style="justify-content:center"><button class="button secondary" data-view="${isToday?'home':'calendar'}">${isToday?'回首頁':'回月曆'}</button></div></section>`;
 if(isToday){ROOT.querySelector('#extra-review').onclick=()=>startExtra('review');ROOT.querySelector('#extra-preview').onclick=()=>startExtra('preview');}
 ROOT.querySelector('[data-view]').onclick=e=>showView(e.currentTarget.dataset.view);updateSyncTag();
}
function renderCalendar(){if(!calendarCursor)calendarCursor=today().slice(0,7);const [year,month]=calendarCursor.split('-').map(Number);const first=new Date(Date.UTC(year,month-1,1));const offset=(first.getUTCDay()+6)%7;const n=new Date(Date.UTC(year,month,0)).getUTCDate();const stamps=[];for(let i=0;i<offset;i++)stamps.push('');for(let day=1;day<=n;day++)stamps.push(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
 ROOT.innerHTML=`${hero()}<section class="panel"><div class="section-head"><div><h2>學習月曆</h2><p>點完成的日期，可查看那天的截圖卡。</p></div></div><div class="calendar-bar"><button id="prev-month" class="button secondary">‹ 上個月</button><span class="cal-title">${year} 年 ${month} 月</span><button id="next-month" class="button secondary">下個月 ›</button></div><div class="calendar-grid">${['一','二','三','四','五','六','日'].map(x=>`<div class="weekday">週${x}</div>`).join('')}${stamps.map(date=>{if(!date)return '<div class="cal-day blank"></div>';const d=S.days[date];const exam=date===EXAM||date==='2027-05-16';const cls=`cal-day ${date===today()?'today':''} ${d?.finished?'done':d&&date<today()?'missed':''} ${exam?'exam':''}`;const info=exam?'會考':d?.finished?`✓ ${d.passed.length} 字`:d?`${d.passed.length}/${d.goal}`:'';return d?.finished?`<button type="button" data-receipt="${date}" class="${cls}" title="點擊查看 ${esc(date)} 的完成卡"><div class="num">${+date.slice(8)}</div><div class="cal-note">${esc(info)}</div></button>`:`<div class="${cls}" title="${esc(date)} ${esc(info)}"><div class="num">${+date.slice(8)}</div><div class="cal-note">${esc(info)}</div></div>`;}).join('')}</div><div class="legend"><span>🟩 完成當日配額</span><span>🟧 開始但尚未完成</span><span>🟨 會考日</span></div></section>`;
 ROOT.querySelector('#prev-month').onclick=()=>changeMonth(-1);ROOT.querySelector('#next-month').onclick=()=>changeMonth(1);ROOT.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>showFinished(S.days[b.dataset.receipt],b.dataset.receipt));}
function changeMonth(delta){const [y,m]=calendarCursor.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));calendarCursor=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;renderCalendar();}
function renderLibrary(){const query=libraryQuery.trim().toLocaleLowerCase();
 const subset=WORDS.filter(w=>(libraryLevel==='all'||w.level===libraryLevel)&& (libraryTopic==='all'||groupOf(w)===libraryTopic) &&(!query||[w.word,w.chinese,w.official_label,...w.aliases].some(s=>String(s).toLocaleLowerCase().includes(query))));
 // 字庫可按學習主題瀏覽；不是按字母順序排每日任務。
 const pages=Math.max(1,Math.ceil(subset.length/24));libraryPage=Math.min(libraryPage,pages-1);const page=subset.slice(libraryPage*24,libraryPage*24+24);
 ROOT.innerHTML=`<section class="hero"><div><div class="eyebrow">THEMES</div><h1>主題字庫 📚</h1></div><div class="hero-date"><small>全部詞目</small><b>${WORDS.length}</b></div></section><section class="panel"><div class="searchbox"><input id="search-vocab" value="${esc(libraryQuery)}" placeholder="🔍 搜尋單字／中文" aria-label="搜尋字庫"><select id="topic-vocab" aria-label="主題分類"><option value="all">全部主題</option>${TOPICS.map(topic=>`<option value="${esc(topic)}" ${libraryTopic===topic?'selected':''}>${esc(topic)}</option>`).join('')}</select><select id="level-vocab"><option value="all">全部字級</option><option value="basic" ${libraryLevel==='basic'?'selected':''}>基本詞目</option><option value="extended" ${libraryLevel==='extended'?'selected':''}>延伸詞目</option></select></div><p class="muted small">共 ${subset.length} 個詞目</p><div class="vocab-list">${page.map(w=>`<div class="vocab-item"><div class="vocab-line"><b>${esc(w.word)}</b><button type="button" class="listen-btn tiny" data-listen-word="${esc(w.id)}" aria-label="朗讀 ${esc(w.word)}">🔊</button></div><span class="small">${esc(w.chinese)}</span><div class="vocab-line"><p class="library-example">${esc(sentenceFor(w))}</p><button type="button" class="listen-btn tiny" data-listen-example="${esc(w.id)}" aria-label="朗讀例句">🔊</button></div></div>`).join('')}</div><div class="page-nav"><button class="button secondary" id="library-prev" ${libraryPage===0?'disabled':''}>上一頁</button><span class="small muted">${libraryPage+1} / ${pages}</span><button class="button secondary" id="library-next" ${libraryPage>=pages-1?'disabled':''}>下一頁</button></div></section>`;
 const input=ROOT.querySelector('#search-vocab');let timer;input.oninput=e=>{libraryQuery=e.target.value;libraryPage=0;clearTimeout(timer);timer=setTimeout(()=>{renderLibrary();document.querySelector('#search-vocab')?.focus();},230);};
 ROOT.querySelector('#topic-vocab').onchange=e=>{libraryTopic=e.target.value;libraryPage=0;renderLibrary();};
 ROOT.querySelector('#level-vocab').onchange=e=>{libraryLevel=e.target.value;libraryPage=0;renderLibrary();};
 ROOT.querySelector('#library-prev').onclick=()=>{libraryPage--;renderLibrary();};ROOT.querySelector('#library-next').onclick=()=>{libraryPage++;renderLibrary();};ROOT.querySelectorAll('[data-listen-word]').forEach(b=>b.onclick=()=>speak(WORDS_BY_ID.get(b.dataset.listenWord).word));ROOT.querySelectorAll('[data-listen-example]').forEach(b=>b.onclick=()=>speak(sentenceFor(WORDS_BY_ID.get(b.dataset.listenExample))));
}
function accountContent(){const configured=!!supabase,rate=S.settings.voiceRate||0.86;return `${hero()}<section class="panel account-panel"><h2>☁ 保護學習進度</h2>${!configured?`<p class="notice compact">目前為本機試用。需要部署者完成雲端設定後，才能用帳號備份並在換手機後復原。</p>`:cloudUser?`<p class="muted small">已登入：${esc(cloudUser.email||'')}</p><div class="backup-status"><span id="sync-indicator">${syncStatus==='synced'?'☁ 已備份':syncStatus==='error'?'⚠ 備份失敗':'待備份'}</span></div><div class="actions"><button class="button" id="sync-now">立即備份</button><button class="button outline" id="sign-out">登出</button></div>`:`<div class="form-row"><div class="form-field"><label for="email">電子郵件</label><input id="email" type="email" autocomplete="email"></div><div class="form-field"><label for="password">密碼</label><input id="password" type="password" minlength="8" autocomplete="current-password"></div></div><div class="actions"><button class="button" id="sign-in">登入</button><button class="button secondary" id="sign-up">註冊</button></div><p class="help">註冊後可能需要先至信箱驗證。</p>`}</section><section class="panel"><h2>📲 放到手機主畫面</h2><div class="install-guide" id="install-guide"><p>iPhone：Safari 分享 → 加入主畫面</p><p>Android：Chrome 選單 → 安裝或建立捷徑</p></div><button class="button secondary" id="install-now">加入主畫面</button></section><section class="panel"><h2>🔊 朗讀速度</h2><div class="voice-picker"><button data-voice="0.72" class="voice-choice ${rate<=0.78?'selected':''}">慢速</button><button data-voice="0.86" class="voice-choice ${rate>0.78&&rate<0.97?'selected':''}">標準</button><button data-voice="1" class="voice-choice ${rate>=0.97?'selected':''}">一般</button><button id="voice-demo" class="listen-btn" type="button">🔊 試聽</button></div></section><section class="panel"><h2>👤 我的資料</h2><div class="form-field"><label for="nickname">顯示名稱</label><input id="nickname" maxlength="40" value="${esc(S.settings.nickname)}" placeholder="例如：7號 小安"></div><button id="save-nickname" class="button secondary">儲存</button><div class="divider"></div><div class="actions"><button id="export-backup" class="button outline">匯出備份檔</button><label class="button outline import-label" for="import-backup">匯入備份<input id="import-backup" type="file" accept=".json,application/json" hidden></label></div></section>`;}
function renderAccount(){ROOT.innerHTML=accountContent();ROOT.querySelector('#save-nickname').onclick=async()=>{const nick=ROOT.querySelector('#nickname').value.trim();if(!nick){notify('請填寫顯示名稱');return;}S.settings.nickname=nick;persist();await syncProfile();notify('已儲存');};
 ROOT.querySelector('#export-backup').onclick=()=>downloadBlob(JSON.stringify({version:3,exportedAt:new Date().toISOString(),data:S},null,2),'單字日課_個人學習備份.json','application/json');
 ROOT.querySelector('#import-backup').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>4*1024*1024){notify('檔案過大');return;}
 try{const pack=JSON.parse(await file.text()),d=pack?.data;if(pack.version!==3||!d||!d.settings||!d.progress||!d.days||!GOALS.includes(d.settings.goal)||Array.isArray(d.progress)||Array.isArray(d.days)||typeof d.progress!=='object'||typeof d.days!=='object')throw new Error('檔案格式不正確');if(Object.keys(d.progress).some(id=>!WORDS_BY_ID.has(id)))throw new Error('包含陌生的字庫項目');
 if(!confirm('將備份合併進目前的學習進度？'))return;S=mergeStates(S,d);persist();notify('備份已合併');showView('home');}catch(err){notify('匯入失敗：'+err.message);}};
 ROOT.querySelectorAll('[data-voice]').forEach(b=>b.onclick=()=>{S.settings.voiceRate=Number(b.dataset.voice);persist();renderAccount();});
 ROOT.querySelector('#voice-demo').onclick=()=>speak('I study English every day.');
 ROOT.querySelector('#install-now').onclick=installApp;const guide=ROOT.querySelector('#install-guide');if(isStandalone())guide.innerHTML='<p>✓ 已經從主畫面開啟</p>';
 if(!supabase)return;if(cloudUser){ROOT.querySelector('#sign-out').onclick=signOut;ROOT.querySelector('#sync-now').onclick=async()=>{if(!cloudReady){await handleLogin(cloudUser);notify(cloudReady?'已重新連上雲端':'雲端仍無法連線，請檢查網路');return;}pendingSync=true;syncStatus='pending';updateSyncTag();const ok=await flushCloudBackup();notify(ok?'雲端備份完成':'備份尚未成功，請檢查網路或資料庫設定');};}
 else{ROOT.querySelector('#sign-in').onclick=()=>authForm('login');ROOT.querySelector('#sign-up').onclick=()=>authForm('signup');}
}
async function authForm(mode){const email=ROOT.querySelector('#email').value.trim(),password=ROOT.querySelector('#password').value;if(!email.includes('@')||password.length<8){notify('請填寫有效信箱與至少 8 碼密碼。');return;}try{const response=mode==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(response.error)throw response.error;if(mode==='signup'&&!response.data.session)notify('帳號已送出，請先至信箱完成驗證，再回來登入。');else{notify('登入成功。');await handleLogin(response.data.user);}}catch(e){notify('帳號操作失敗：'+e.message);}}
async function handleLogin(user){if(!user)return;cloudUser=user;cloudReady=false;syncStatus='pending';localStorage.setItem('vocab-last-account',user.id);localKey='vocab-daily-v3:'+user.id;
 let local=loadLocal(localKey),remote=null,loaded=false;
 try{const result=await supabase.from('student_progress').select('payload').eq('user_id',user.id).maybeSingle();if(result.error)throw result.error;remote=result.data?.payload;loaded=true;}
 catch(e){console.warn('無法讀取雲端進度',e);notify('目前只能讀取這台裝置的紀錄；請稍後再試。');}
 S=mergeStates(local,remote);
 // 首次登入時，允許學生自行選擇是否合併同一台裝置的訪客紀錄。
 const guest=loadLocal('vocab-daily-v3:guest');
 if(loaded&&(Object.keys(guest.progress).length||Object.keys(guest.days).length)&&!localStorage.getItem('vocab-guest-migration:'+user.id)){
  const yes=confirm('這台裝置有未登入的學習紀錄，要合併到這個帳號嗎？（若是共用裝置，請選取消）');
  if(yes)S=mergeStates(S,guest);
  localStorage.setItem('vocab-guest-migration:'+user.id,'asked');
 }
 localStorage.setItem(localKey,JSON.stringify(S));cloudReady=loaded;pendingSync=loaded;syncStatus=loaded?'pending':'error';updateSyncTag();
 if(loaded){await syncProfile();await flushCloudBackup();}
 showView('home');
}
async function signOut(){if(cloudUser&&cloudReady&&pendingSync)await flushCloudBackup();try{await supabase.auth.signOut();}catch(e){console.warn(e);}
 cloudUser=null;cloudReady=false;localStorage.removeItem('vocab-last-account');localKey='vocab-daily-v3:guest';S=loadLocal(localKey);syncStatus='local';updateSyncTag();notify('已登出');showView('account');}
function downloadBlob(contents,name,mime){const blob=new Blob([contents],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function renderTeacher(){if(!cloudUser||!isTeacher){showView('home');return;}ROOT.innerHTML=`<section class="hero"><div><div class="eyebrow">CLASSROOM CHECK-IN</div><h1>導師每日查核</h1><p>快速查看昨天有哪些同學完成每日練習配額。</p></div><div class="hero-date"><small>查核日期</small><b style="font-size:18px">${formatDay(yesterday())}</b><small>台灣時間</small></div></section><section class="panel"><h2>我的班級</h2><div class="form-row"><div class="form-field"><label>班級名稱</label><input id="class-name" maxlength="60" placeholder="例如：八年七班"></div><div class="form-field"><label>邀請碼（英數至少 6 碼）</label><input id="class-code" maxlength="25" placeholder="例如：MINGDE713"></div></div><div class="actions"><button id="create-class" class="button secondary">建立班級</button></div><div class="divider"></div><div class="form-field"><label>選擇班級</label><select id="teacher-select"><option value="">載入中…</option></select></div></section><section class="panel" id="teacher-roster"><div class="loading">正在載入學生紀錄…</div></section>`;
 ROOT.querySelector('#create-class').onclick=createClass;await loadTeacherClasses();}
async function createClass(){const name=ROOT.querySelector('#class-name').value.trim(),code=ROOT.querySelector('#class-code').value.trim().toUpperCase();if(name.length<2||!/^[A-Z0-9-]{6,25}$/.test(code)){notify('請填寫班級名稱，邀請碼需 6–25 碼英文大寫、數字或連字號。');return;}try{const {error}=await supabase.from('classrooms').insert({name,join_code:code,teacher_id:cloudUser.id});if(error)throw error;notify('班級已建立。');await renderTeacher();}catch(e){notify('建立失敗：'+e.message);}}
async function loadTeacherClasses(){try{const {data,error}=await supabase.from('classrooms').select('id,name,join_code').eq('teacher_id',cloudUser.id).order('name');if(error)throw error;teacherClasses=data||[];if(!teacherClasses.length){ROOT.querySelector('#teacher-select').innerHTML='<option value="">請先建立班級</option>';ROOT.querySelector('#teacher-roster').innerHTML='<p class="muted">尚未建立班級。建立後，把邀請碼提供給學生，待他們申請並核准即可查看紀錄。</p>';return;}if(!currentClass||!teacherClasses.some(x=>x.id===currentClass))currentClass=teacherClasses[0].id;ROOT.querySelector('#teacher-select').innerHTML=teacherClasses.map(c=>`<option value="${esc(c.id)}" ${c.id===currentClass?'selected':''}>${esc(c.name)}（邀請碼：${esc(c.join_code)}）</option>`).join('');ROOT.querySelector('#teacher-select').onchange=e=>{currentClass=e.target.value;loadTeacherRoster();};await loadTeacherRoster();}catch(e){ROOT.querySelector('#teacher-roster').textContent='班級讀取失敗：'+e.message;}}
async function loadTeacherRoster(){const el=ROOT.querySelector('#teacher-roster');if(!el)return;el.innerHTML='<div class="loading">正在讀取昨日紀錄…</div>';try{const r=await supabase.from('enrollments').select('student_id,seat_no,approved,profiles!enrollments_student_id_fkey(nickname)').eq('class_id',currentClass).order('seat_no');if(r.error)throw r.error;const enrollments=r.data||[];let completions=[];if(enrollments.length){const ids=enrollments.map(e=>e.student_id);const done=await supabase.from('daily_completions').select('user_id,goal,passed_count,completed_at').eq('study_date',yesterday()).in('user_id',ids);if(done.error)throw done.error;completions=done.data||[];}const byUser=new Map(completions.map(c=>[c.user_id,c]));const approved=enrollments.filter(e=>e.approved),pending=enrollments.filter(e=>!e.approved);const finished=approved.filter(e=>byUser.has(e.student_id));
 el.innerHTML=`<div class="section-head"><div><h2>昨日完成紀錄｜${formatDay(yesterday())}</h2><p>核准名單：${approved.length} 人，完成：${finished.length} 人，尚未完成：${approved.length-finished.length} 人</p></div><button id="export-attendance" class="button secondary">下載 CSV</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>座號</th><th>學習者</th><th>昨日完成</th><th>配額</th><th>雲端完成時間</th></tr></thead><tbody>${approved.map(e=>{const c=byUser.get(e.student_id);return `<tr><td>${e.seat_no}</td><td>${esc(e.profiles?.nickname||'（未設定）')}</td><td>${c?'<span class="pill good">✓ 已完成</span>':'<span class="pill bad">未完成</span>'}</td><td>${c?`${c.passed_count} / ${c.goal}`:'—'}</td><td>${c?esc(new Date(c.completed_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})):'—'}</td></tr>`;}).join('')||'<tr><td colspan="5">目前沒有已核准的學生</td></tr>'}</tbody></table></div>${pending.length?`<div class="divider"></div><h3>待核准申請（${pending.length}）</h3><div class="table-scroll"><table class="data-table"><thead><tr><th>座號</th><th>名稱</th><th>操作</th></tr></thead><tbody>${pending.map(e=>`<tr><td>${e.seat_no}</td><td>${esc(e.profiles?.nickname||'（未設定）')}</td><td><button data-approve="${esc(e.student_id)}">核准加入</button> <button data-reject="${esc(e.student_id)}">移除申請</button></td></tr>`).join('')}</tbody></table></div>`:''}<p class="help">完成時間由伺服器記錄，學生不能直接修改完成狀態。但瀏覽器端答題仍有自我操作成分，不宜視為不可作弊的正式考試。</p>`;
 el.querySelector('#export-attendance').onclick=()=>{const rows=[['座號','名稱','查核日期','是否完成','配額','成功詞目','完成時間'],...approved.map(e=>{const c=byUser.get(e.student_id);return [e.seat_no,e.profiles?.nickname||'',yesterday(),c?'完成':'未完成',c?.goal||'',c?.passed_count||'',c?.completed_at||''];})];const csv='\ufeff'+rows.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\r\n');downloadBlob(csv,`單字練習查核_${yesterday()}.csv`,'text/csv;charset=utf-8');};el.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveStudent(b.dataset.approve));
 el.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>removeStudentApplication(b.dataset.reject));
 }catch(e){el.textContent='查核失敗：'+e.message;}}
async function approveStudent(id){if(!confirm('已確認這是正確的學生座號與身分，核准加入班級？'))return;try{const {error}=await supabase.from('enrollments').update({approved:true}).eq('class_id',currentClass).eq('student_id',id);if(error)throw error;notify('學生已核准。');await loadTeacherRoster();}catch(e){notify('核准失敗：'+e.message);}}
async function removeStudentApplication(id){if(!confirm('確定移除這筆待核准申請？學生可用正確的座號重新加入。'))return;try{const {error}=await supabase.from('enrollments').delete().eq('class_id',currentClass).eq('student_id',id).eq('approved',false);if(error)throw error;notify('待核准申請已移除。');await loadTeacherRoster();}catch(e){notify('移除失敗：'+e.message);}}
function isStandalone(){return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
async function installApp(){if(isStandalone()){notify('已經放到主畫面囉');return;}
 if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch(e){console.warn('install prompt:',e);}return;}
 notify(isIOS()?'請用 Safari 分享選單 → 加入主畫面':'請在 Chrome 的選單中選「安裝或建立捷徑」，再選「安裝」');
}
function bindGlobalUI(){document.querySelectorAll('.nav-btn,#account-shortcut').forEach(b=>{if(!b.dataset.bound){b.addEventListener('click',()=>showView(b.dataset.view));b.dataset.bound='1';}});
 const install=document.getElementById('install-shortcut');if(install)install.addEventListener('click',installApp);
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
 window.addEventListener('online',()=>{if(cloudUser&&!cloudReady)handleLogin(cloudUser).catch(e=>console.warn(e));else if(cloudUser&&cloudReady&&pendingSync)queueProgressSync();else if(!cloudUser&&localKey!=='vocab-daily-v3:guest')notify('網路已恢復，重新開啟 App 並登入即可同步學習紀錄。');});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cloudUser&&cloudReady&&pendingSync)queueProgressSync();});
 const toggle=document.getElementById('mobile-menu-toggle');if(toggle&&!toggle.dataset.bound){toggle.addEventListener('click',toggleMobileMenu);toggle.dataset.bound='1';}
 window.addEventListener('resize',()=>{if(!mobileMode())closeMobileMenu();},{passive:true});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileMenu();});
}
function showView(name){clearTimeout(advanceTimer);advanceTimer=null;view=name;document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===name));closeMobileMenu();if(name==='home')renderHome();else if(name==='calendar')renderCalendar();else if(name==='library')renderLibrary();else if(name==='account')renderAccount();}
async function init(){bindGlobalUI();try{WORDS=await loadWordsData();if(WORDS.length!==2005||new Set(WORDS.map(x=>x.id)).size!==2005)throw new Error('官方字庫數量或ID不一致');WORDS_BY_ID=new Map(WORDS.map(w=>[w.id,w]));const offlineAccount=localStorage.getItem('vocab-last-account');if(offlineAccount){localKey='vocab-daily-v3:'+offlineAccount;}S=loadLocal(localKey);
 const c=window.VOCAB_CLOUD_CONFIG||{};if(c.url&&c.anonKey&&window.supabase?.createClient){supabase=window.supabase.createClient(c.url,c.anonKey);try{const {data:{session}}=await supabase.auth.getSession();if(session?.user)await handleLogin(session.user);}catch(e){console.warn('初始登入失敗',e);}}updateSyncTag();const params=new URLSearchParams(location.search);showView(params.get('view')==='calendar'?'calendar':'home');if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});
 }catch(e){ROOT.innerHTML=`<section class="panel"><h2>字庫載入失敗</h2><p>${esc(e.message)}</p><p>請確認 <code>index.html</code>、<code>app.js</code>、<code>styles.css</code>、<code>word-data-full.json</code> 與 <code>word-data-full.js</code> 都在同一個資料夾。</p><p>若放到網站伺服器（例如 GitHub Pages）可讀取 JSON；若是直接雙擊本機 HTML，系統會改用內建字庫。</p></section>`;console.error(e);}}
window.__VOCAB_TEST__={today,dateTaipei,addDays,diffDays,getWords:()=>WORDS,getState:()=>S,makePlan:startPlan,lightMetrics,groupOf,go:showView,login:handleLogin,mergeStates,installApp};
init();
})();

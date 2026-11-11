/* 單字日課 v3 — 純前端學習引擎 + 可選 Supabase 雲端帳號 */
(()=>{'use strict';
const EXAM='2027-05-15', FINAL_STUDY='2027-05-14', GOALS=[15,30,50], GOAL_NAMES={15:'輕量組・浮動',30:'標準組',50:'考前衝刺組'};
const ROOT=document.getElementById('view-root');
let WORDS=[],WORDS_BY_ID=new Map(),supabase=null,cloudUser=null,isTeacher=false,view='home';
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
function goalLabel(d){const mode=d?.mode||S.settings.goal;return GOAL_NAMES[mode]||'每日任務';}
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

function emptyState(){return {settings:{goal:30,nickname:'本機使用者'},progress:{},days:{},updatedAt:null};}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dateTaipei(d=new Date()){const obj=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${obj.year}-${obj.month}-${obj.day}`;}
function addDays(date,number){const d=new Date(`${date}T12:00:00+08:00`);d.setUTCDate(d.getUTCDate()+number);return dateTaipei(d);}
function diffDays(a,b){return Math.round((Date.parse(b+'T12:00:00+08:00')-Date.parse(a+'T12:00:00+08:00'))/86400000);}
function formatDay(day){return day.replaceAll('-','/');}
function today(){return dateTaipei();}
function yesterday(){return addDays(today(),-1);}
function notify(msg){const t=document.getElementById('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,4200);}
function loadLocal(k){try{const d=JSON.parse(localStorage.getItem(k));if(d && d.settings && d.progress && d.days)return {...emptyState(),...d};}catch(e){}return emptyState();}
function persist(){S.updatedAt=new Date().toISOString();localStorage.setItem(localKey,JSON.stringify(S));if(cloudUser)queueProgressSync();}
function queueProgressSync(){if(!cloudUser||!supabase)return;const userId=cloudUser.id;const snapshot=JSON.parse(JSON.stringify(S));syncChain=syncChain.then(async()=>{const {error}=await supabase.from('student_progress').upsert({user_id:userId,payload:snapshot,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;}).catch(e=>{console.warn('Progress sync failed',e.message);return null;});}
async function syncProfile(){if(!cloudUser)return;const {error}=await supabase.from('profiles').upsert({user_id:cloudUser.id,nickname:S.settings.nickname.slice(0,40)},{onConflict:'user_id'});if(error)console.warn('Profile sync failed',error.message);}
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
function renderHome(){const day=sessionToday(),g=dayGoal(day),passed=day?.passed?.length||0,projection=dateProjection(),finish=day?.finished,m=lightMetrics();
 ROOT.innerHTML=hero()+`<section class="panel home-task"><div class="section-head"><div><h2>🎯 今日任務</h2><p>${goalLabel(day)} · ${g} 個</p></div><span class="pill ${finish?'good':''}">${finish?(day.cloudConfirmedAt?'☑ 已完成':'✓ 已完成'):(day?'進行中':'未開始')}</span></div>${progressBar(passed,g)}<button id="start-study" class="button wide big-action">${finish?'查看完成紀錄':day?'繼續複習 →':'開始今日練習 →'}</button></section>`+
 `<section class="panel"><div class="section-head"><div><h2>📆 每日學習量</h2><p>輕量組會每天重新計算</p></div></div>${goalButtons()}</section>`+
 `<div class="cards"><div class="stat-card accent-blue"><div class="label">首次答對</div><strong>${WORDS.length-unseenCount()}</strong><small>／${WORDS.length}</small></div><div class="stat-card accent-mint"><div class="label">待複習</div><strong>${dueCount()}</strong></div><div class="stat-card accent-peach"><div class="label">已熟練</div><strong>${matureCount()}</strong></div></div>`+
 `<section class="panel small-summary"><div class="section-head"><div><h2>🏁 首輪預估</h2></div><strong class="big-date">${formatDay(projection.date)}</strong></div><p class="muted small">剩下 ${projection.remaining} 個尚未首次答對的字${S.settings.goal===15?` · ${m.dailyNew} 個新字／天`:''}</p></section>`;
 ROOT.querySelector('#start-study').addEventListener('click',()=>finish?showFinished(day):startStudy());ROOT.querySelectorAll('[data-goal]').forEach(b=>b.addEventListener('click',()=>setGoal(+b.dataset.goal)));
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
async function startStudy(){let d=sessionToday();if(!d){d=startPlan(S.settings.goal);S.days[today()]=d;persist();}if(cloudUser){try{const {data,error}=await supabase.rpc('begin_day',{p_goal:d.goal});if(error)throw error;if(Number(data)!==d.goal){
   if(d.passed.length===0 && Number.isInteger(Number(data)) && Number(data)>0 && Number(data)<=WORDS.length){
     d=startPlan(d.mode||S.settings.goal);if(d.goal!==Number(data)){const ids=d.plan.slice(0,Number(data));if(ids.length<Number(data)){notify('雲端配額和本機任務無法一致，請重新登入後再試。');showView('home');return;}d.goal=Number(data);d.plan=ids;d.queue=[...ids];}S.days[today()]=d;persist();notify(`雲端今日配額已固定為 ${data} 個，已調整本機任務。`);
   }else{
     notify(`雲端今日配額是 ${data} 個，本機是 ${d.goal} 個。為避免完成紀錄錯誤，請在同一裝置完成或聯絡導師。`);
     showView('home');return;
   }
 }await syncDailyCloud(d);}catch(e){notify('雲端暫時無法同步：可以本機練習，但導師紀錄尚未成立。');}}
 if(d.finished){showFinished(d);return;} renderQuiz();}
function hashId(str){let h=2166136261;for(const c of str){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;}
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
function renderQuiz(){view='quiz';clearTimeout(advanceTimer);advanceTimer=null;
 const d=sessionToday();if(!d)return showView('home');if(d.queue.length===0){finishDay(d);showFinished(d);return;}
 const id=d.queue[0],w=WORDS_BY_ID.get(id);if(!w){d.queue.shift();persist();return renderQuiz();}
 activeWordId=id;activeMode=questionMode(w,d);answered=false;const mode=activeMode;
 const choices=shuffle([w,...distractors(w,mode)]);let question='',prompt='';
 if(mode==='e2c'){prompt='選出中文意思';question=w.word;}
 else if(mode==='c2e'){prompt='選出英文單字';question=w.chinese;}
 else if(mode==='spell'){prompt='試著拼出英文';question=w.chinese;}
 else{prompt='用例句找出正確的字';question=w.chinese;}
 // 中翻英、拼寫、克漏字：例句先出現，答案單字先挖空，避免直接洩題。
 const example=sentenceFor(w,mode!=='e2c');
 ROOT.innerHTML=`<div class="quiz-top"><button id="quiz-back" class="button outline">← 返回</button><span class="wordmark">${goalLabel(d)} · ${d.passed.length}/${d.goal}</span></div><section class="quiz-card"><div class="quiz-inline"><b>${d.passed.length} / ${d.goal}</b>${progressBarOnly(d.passed.length,d.goal)}</div><div class="divider"></div><div class="quiz-prompt">${esc(prompt)}</div><div class="quiz-word">${esc(question)}</div><div class="context-example"><span class="example-mark">📖 例句</span><p>${esc(example)}</p></div>${mode==='spell'?'<form id="spell-form" class="spell-form"><input id="spell-input" type="text" aria-label="輸入英文拼寫" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="輸入英文" required maxlength="50"><button class="button" type="submit">確認</button></form>':`<div id="options" class="options">${choices.map((option,i)=>`<button class="option" data-opt="${esc(option.id)}"><span class="muted small">${i+1}.</span> ${esc(mode==='e2c'?option.chinese:option.word)}</button>`).join('')}</div>`}<div id="answer-box" hidden></div><div class="quiz-bottom"><button id="sound-btn" class="button secondary">🔊 發音</button><button id="quiz-next" class="button" hidden>下一題 →</button></div></section>`;
 ROOT.querySelector('#quiz-back').onclick=()=>showView('home');ROOT.querySelector('#sound-btn').onclick=()=>speak(w.word);
 ROOT.querySelectorAll('[data-opt]').forEach(b=>b.addEventListener('click',()=>answer(b.dataset.opt)));
 if(mode==='spell'){ROOT.querySelector('#spell-form').onsubmit=e=>{e.preventDefault();answer(ROOT.querySelector('#spell-input').value);};ROOT.querySelector('#spell-input').focus();}
 ROOT.querySelector('#quiz-next').onclick=()=>{clearTimeout(advanceTimer);if(d.finished)showFinished(d);else renderQuiz();};
}
function progressBarOnly(done,total){return `<div class="progress-track" style="flex:1"><div style="width:${Math.round(done/total*100)}%"></div></div>`;}
function speak(word){if(!('speechSynthesis' in window)){notify('此裝置沒有提供語音朗讀。');return;}speechSynthesis.cancel();const v=new SpeechSynthesisUtterance(word);v.lang='en-US';v.rate=.86;speechSynthesis.speak(v);}
function updateLearning(word,correct,failedBefore){const old=S.progress[word.id]||{stage:0,seenOn:today(),successDays:0,lastSuccess:null};let nextStage=0,days=1,successDays=old.successDays||0;
 if(correct){nextStage=failedBefore?0:Math.min(7,old.stage+1);days=([1,1,3,7,14,30,60,90][nextStage]||90);if(old.lastSuccess!==today())successDays+=1;}
 S.progress[word.id]={...old,stage:nextStage,nextDue:addDays(today(),days),successDays,lastSuccess:correct?today():old.lastSuccess,lastAttempt:today()};}
function answer(chosenId){const d=sessionToday();if(!d||answered)return;const w=WORDS_BY_ID.get(activeWordId);if(!w)return;
 const normalize=s=>String(s||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
 const right=activeMode==='spell'?[w.word,...w.aliases].some(alias=>normalize(alias)===normalize(chosenId)):chosenId===w.id;
 answered=true;lastCorrect=right;
 ROOT.querySelectorAll('[data-opt]').forEach(b=>{b.disabled=true;if(b.dataset.opt===w.id)b.classList.add('correct');if(b.dataset.opt===chosenId&&!right)b.classList.add('wrong');});
 if(activeMode==='spell'){const input=ROOT.querySelector('#spell-input');input.disabled=true;ROOT.querySelector('#spell-form button').disabled=true;input.classList.add(right?'correct-input':'wrong-input');}
 if(right){const hadMistake=!!d.fails[w.id];updateLearning(w,true,hadMistake);d.passed.push(w.id);d.queue.shift();}
 else{updateLearning(w,false,false);d.fails[w.id]=(d.fails[w.id]||0)+1;d.queue.shift();d.queue.splice(Math.min(2,d.queue.length),0,w.id);}
 persist();if(right&&cloudUser)submitCloudPass(w.id,d);
 const panel=ROOT.querySelector('#answer-box');panel.hidden=false;panel.className='answer-panel';
 if(right){panel.innerHTML='<b>✓ 答對了！</b>';}else{
  panel.innerHTML=`<b>再記一下 👀</b><p><strong>${esc(w.word)}</strong> · ${esc(w.chinese)}</p><p class="small">${esc(sentenceFor(w))}</p>`;
 }
 const next=ROOT.querySelector('#quiz-next');next.hidden=right;next.textContent=d.queue.length?'下一題 →':'查看今日完成';
 ROOT.querySelector('.quiz-inline b').textContent=`${d.passed.length} / ${d.goal}`;
 ROOT.querySelector('.quiz-inline .progress-track>div').style.width=`${d.passed.length/d.goal*100}%`;
 if(d.queue.length===0)finishDay(d);
 if(right){advanceTimer=setTimeout(()=>{advanceTimer=null;if(view==='quiz'&&sessionToday()===d){if(d.finished)showFinished(d);else renderQuiz();}},520);}
}
function finishDay(d){if(!d.finished){d.finished=true;d.finishedAt=new Date().toISOString();persist();if(cloudUser)queueFinishCloud(d);} }
function showFinished(d){showView('finished');ROOT.innerHTML=`<section class="panel center success-panel"><div class="success-icon">🌿</div><h1>今天完成了！</h1><p>你今天完成了 <b>${d.passed.length}</b> 個詞目的練習。</p><span class="pill ${d.cloudConfirmedAt?'good':''}">${d.cloudConfirmedAt?'雲端已記錄':'本機完成紀錄'}</span><p class="help">${cloudUser?(d.cloudConfirmedAt?'明天導師就能看到完成紀錄。':'若要讓導師查核，請保持網路並重新開啟一次。'):'未登入雲端帳號時，只會留在這台裝置。'}</p><div class="actions" style="justify-content:center"><button class="button" data-view="calendar">看月曆</button><button class="button secondary" data-view="home">回首頁</button></div></section>`;
 ROOT.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
}
async function queueFinishCloud(d){if(!cloudUser||!d.finished)return;try{const {data,error}=await supabase.rpc('finish_day');if(error)throw error;if(data===true){d.cloudConfirmedAt=new Date().toISOString();persist();if(view==='finished')showFinished(d);}}catch(e){console.warn('Finish sync',e);notify('完成紀錄尚未雲端驗證，請檢查網路並於當天重新開啟。');}}
async function syncDailyCloud(d){if(!cloudUser||!d)return;try{await beginCloudDay(d);for(const wordId of d.passed){if(!d.cloudSyncedPasses?.includes(wordId)){const {error}=await supabase.rpc('submit_pass',{p_word_id:wordId});if(error)throw error;if(!d.cloudSyncedPasses)d.cloudSyncedPasses=[];d.cloudSyncedPasses.push(wordId);}}if(d.finished)await queueFinishCloud(d);persist();}catch(e){console.warn('syncDailyCloud',e);}}
function renderCalendar(){if(!calendarCursor)calendarCursor=today().slice(0,7);const [year,month]=calendarCursor.split('-').map(Number);const first=new Date(Date.UTC(year,month-1,1));const offset=(first.getUTCDay()+6)%7;const n=new Date(Date.UTC(year,month,0)).getUTCDate();const stamps=[];for(let i=0;i<offset;i++)stamps.push('');for(let day=1;day<=n;day++)stamps.push(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
 ROOT.innerHTML=`${hero()}<section class="panel"><div class="section-head"><div><h2>學習月曆</h2><p>只有「完成全部當日配額」才會標示完成。</p></div></div><div class="calendar-bar"><button id="prev-month" class="button secondary">‹ 上個月</button><span class="cal-title">${year} 年 ${month} 月</span><button id="next-month" class="button secondary">下個月 ›</button></div><div class="calendar-grid">${['一','二','三','四','五','六','日'].map(x=>`<div class="weekday">週${x}</div>`).join('')}${stamps.map(date=>{if(!date)return '<div class="cal-day blank"></div>';const d=S.days[date];const exam=date===EXAM||date==='2027-05-16';const cls=`cal-day ${date===today()?'today':''} ${d?.finished?'done':d&&date<today()?'missed':''} ${exam?'exam':''}`;const info=exam?'會考':d?.finished?`✓ ${d.passed.length} 字`:d?`${d.passed.length}/${d.goal}`:'';return `<div class="${cls}" title="${esc(date)} ${esc(info)}"><div class="num">${+date.slice(8)}</div><div class="cal-note">${esc(info)}</div></div>`;}).join('')}</div><div class="legend"><span>🟩 完成當日配額</span><span>🟧 開始但尚未完成</span><span>🟨 會考日</span></div></section>`;
 ROOT.querySelector('#prev-month').onclick=()=>changeMonth(-1);ROOT.querySelector('#next-month').onclick=()=>changeMonth(1);}
function changeMonth(delta){const [y,m]=calendarCursor.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));calendarCursor=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;renderCalendar();}
function renderLibrary(){const query=libraryQuery.trim().toLocaleLowerCase();
 const subset=WORDS.filter(w=>(libraryLevel==='all'||w.level===libraryLevel)&& (libraryTopic==='all'||groupOf(w)===libraryTopic) &&(!query||[w.word,w.chinese,w.official_label,...w.aliases].some(s=>String(s).toLocaleLowerCase().includes(query))));
 // 字庫可按學習主題瀏覽；不是按字母順序排每日任務。
 const pages=Math.max(1,Math.ceil(subset.length/24));libraryPage=Math.min(libraryPage,pages-1);const page=subset.slice(libraryPage*24,libraryPage*24+24);
 ROOT.innerHTML=`<section class="hero"><div><div class="eyebrow">THEMES</div><h1>主題字庫 📚</h1></div><div class="hero-date"><small>全部詞目</small><b>${WORDS.length}</b></div></section><section class="panel"><div class="searchbox"><input id="search-vocab" value="${esc(libraryQuery)}" placeholder="🔍 搜尋單字／中文" aria-label="搜尋字庫"><select id="topic-vocab" aria-label="主題分類"><option value="all">全部主題</option>${TOPICS.map(topic=>`<option value="${esc(topic)}" ${libraryTopic===topic?'selected':''}>${esc(topic)}</option>`).join('')}</select><select id="level-vocab"><option value="all">全部字級</option><option value="basic" ${libraryLevel==='basic'?'selected':''}>基本詞目</option><option value="extended" ${libraryLevel==='extended'?'selected':''}>延伸詞目</option></select></div><p class="muted small">共 ${subset.length} 個詞目</p><div class="vocab-list">${page.map(w=>`<div class="vocab-item"><b>${esc(w.word)}</b><span class="small">${esc(w.chinese)}</span><p class="library-example">${esc(sentenceFor(w))}</p></div>`).join('')}</div><div class="page-nav"><button class="button secondary" id="library-prev" ${libraryPage===0?'disabled':''}>上一頁</button><span class="small muted">${libraryPage+1} / ${pages}</span><button class="button secondary" id="library-next" ${libraryPage>=pages-1?'disabled':''}>下一頁</button></div></section>`;
 const input=ROOT.querySelector('#search-vocab');let timer;input.oninput=e=>{libraryQuery=e.target.value;libraryPage=0;clearTimeout(timer);timer=setTimeout(()=>{renderLibrary();document.querySelector('#search-vocab')?.focus();},230);};
 ROOT.querySelector('#topic-vocab').onchange=e=>{libraryTopic=e.target.value;libraryPage=0;renderLibrary();};
 ROOT.querySelector('#level-vocab').onchange=e=>{libraryLevel=e.target.value;libraryPage=0;renderLibrary();};
 ROOT.querySelector('#library-prev').onclick=()=>{libraryPage--;renderLibrary();};ROOT.querySelector('#library-next').onclick=()=>{libraryPage++;renderLibrary();};
}
function accountContent(){const isConfigured=!!supabase;return `${hero()}<section class="panel"><h2>我的設定</h2><div class="form-field"><label for="nickname">顯示名稱</label><input id="nickname" maxlength="40" value="${esc(S.settings.nickname)}" placeholder="例如：7號 / 小安"></div><div class="actions"><button id="save-nickname" class="button secondary">儲存</button><button id="export-backup" class="button outline">匯出備份</button><label class="button outline import-label" for="import-backup">匯入備份<input id="import-backup" type="file" accept=".json,application/json" hidden></label></div><p class="help">每日學習量請回到「今日任務」調整。</p></section><section class="panel"><h2>帳號同步</h2>${!isConfigured?`<p class="notice compact">目前是本機試用版。若要跨裝置同步、學生登入、導師查核，需先完成 Supabase 設定。</p>`:cloudUser?`<p>目前帳號：<b>${esc(cloudUser.email||'已登入使用者')}</b></p><div class="actions"><button class="button outline" id="sync-now">立即同步</button><button class="button orange" id="sign-out">登出</button></div>`:`<div class="form-row"><div class="form-field"><label for="email">電子郵件</label><input id="email" type="email" autocomplete="email"></div><div class="form-field"><label for="password">密碼</label><input id="password" type="password" minlength="8" autocomplete="current-password"></div></div><div class="actions"><button class="button" id="sign-in">登入</button><button class="button secondary" id="sign-up">註冊</button></div><p class="help">首次註冊可能要先到信箱驗證。</p>`}</section>${cloudUser&&!isTeacher?`<section class="panel"><h2>加入班級</h2><div class="form-row"><div class="form-field"><label for="join-code">班級碼</label><input id="join-code" maxlength="25" placeholder="例如：ABCD-2027"></div><div class="form-field"><label for="seat-num">座號</label><input id="seat-num" type="number" min="1" max="60" placeholder="1–60"></div></div><button id="join-class" class="button">送出申請</button><div id="class-list" class="small muted" style="margin-top:12px"></div></section>`:''}`;}
function renderAccount(){ROOT.innerHTML=accountContent();ROOT.querySelector('#save-nickname').onclick=async()=>{const nick=ROOT.querySelector('#nickname').value.trim();if(!nick){notify('請先填寫顯示名稱。');return;}S.settings.nickname=nick;persist();await syncProfile();notify('名稱已儲存。');};ROOT.querySelector('#export-backup').onclick=()=>downloadBlob(JSON.stringify({version:3,exportedAt:new Date().toISOString(),data:S},null,2),'我的單字日課備份.json','application/json');
 ROOT.querySelector('#import-backup').onchange=async e=>{
   const file=e.target.files?.[0];if(!file)return;
   if(file.size>4*1024*1024){notify('備份檔案過大，請選擇單字日課匯出的 JSON。');return;}
   try{
     const pack=JSON.parse(await file.text());const d=pack?.data;
     if(pack.version!==3||!d||!d.settings||!d.progress||!d.days||!GOALS.includes(d.settings.goal)||Array.isArray(d.progress)||Array.isArray(d.days)||typeof d.progress!=='object'||typeof d.days!=='object')throw new Error('格式不正確');
     if(Object.keys(d.progress).some(id=>!WORDS_BY_ID.has(id)))throw new Error('檔案包含本字庫沒有的詞目');
     if(!confirm('匯入會覆蓋此帳號／瀏覽器現有的本機學習紀錄。確定繼續嗎？'))return;
     S={...emptyState(),...d};persist();notify('備份已匯入，請確認今日進度。');showView('home');
   }catch(err){notify('無法匯入：'+err.message);}
 };
 if(!supabase)return;if(cloudUser){ROOT.querySelector('#sign-out').onclick=signOut;ROOT.querySelector('#sync-now').onclick=async()=>{queueProgressSync();await syncChain;await syncDailyCloud(sessionToday());notify('已提出同步請求；請確認顯示「雲端已登記」後，導師才可查核。');};if(!isTeacher){ROOT.querySelector('#join-class').onclick=joinClass;loadJoinedClasses();}}
 else{ROOT.querySelector('#sign-in').onclick=()=>authForm('login');ROOT.querySelector('#sign-up').onclick=()=>authForm('signup');}}
async function authForm(mode){const email=ROOT.querySelector('#email').value.trim(),password=ROOT.querySelector('#password').value;if(!email.includes('@')||password.length<8){notify('請填寫有效信箱與至少 8 碼密碼。');return;}try{const response=mode==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(response.error)throw response.error;if(mode==='signup'&&!response.data.session)notify('帳號已送出，請先至信箱完成驗證，再回來登入。');else{notify('登入成功。');await handleLogin(response.data.user);}}catch(e){notify('帳號操作失敗：'+e.message);}}
async function handleLogin(user){if(!user)return;cloudUser=user;localKey='vocab-daily-v3:'+user.id;const cached=loadLocal(localKey);S=cached;try{const res=await supabase.from('student_progress').select('payload,updated_at').eq('user_id',user.id).maybeSingle();if(res.error)throw res.error;const remote=res.data?.payload;if(remote&&remote.progress&&remote.days){if(!S.updatedAt||(remote.updatedAt&&remote.updatedAt>S.updatedAt)){S={...emptyState(),...remote};localStorage.setItem(localKey,JSON.stringify(S));}}await syncProfile();const t=await supabase.from('teachers').select('user_id').eq('user_id',user.id).maybeSingle();isTeacher=!!t.data;}catch(e){console.warn('cloud load failed',e.message);notify('已進入帳號，部分雲端資料暫無法讀取。');}
 document.getElementById('connect-tag').textContent=isTeacher?'導師帳號':'雲端帳號';document.getElementById('teacher-nav').hidden=!isTeacher;await syncDailyCloud(sessionToday());showView('home');}
async function signOut(){try{await supabase.auth.signOut();}catch(e){console.warn(e);}cloudUser=null;isTeacher=false;localKey='vocab-daily-v3:guest';S=loadLocal(localKey);document.getElementById('teacher-nav').hidden=true;document.getElementById('connect-tag').textContent='本機試用';notify('已登出；本機試用與帳號資料分開保存。');showView('account');}
async function loadJoinedClasses(){try{const r=await supabase.from('enrollments').select('seat_no,approved,classrooms(name)').eq('student_id',cloudUser.id);if(r.error)throw r.error;ROOT.querySelector('#class-list').innerHTML=r.data.length?r.data.map(x=>`<p>${esc(x.classrooms?.name||'班級')} ｜ ${x.seat_no} 號 ｜ ${x.approved?'✅ 已核准':'⏳ 待導師核准'}</p>`).join(''):'尚未加入班級';}catch(e){console.warn(e);}}
async function joinClass(){const code=ROOT.querySelector('#join-code').value.trim().toUpperCase(),seat=+ROOT.querySelector('#seat-num').value;if(!code||!Number.isInteger(seat)||seat<1||seat>60){notify('請填寫班級碼和 1–60 的座號。');return;}try{await syncProfile();const {error}=await supabase.rpc('join_class',{p_code:code,p_seat_no:seat});if(error)throw error;notify('已送出班級加入申請，請導師核准。');loadJoinedClasses();}catch(e){notify('無法加入班級：'+e.message);}}
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
function bindGlobalUI(){document.querySelectorAll('.nav-btn,#account-shortcut').forEach(b=>{if(!b.dataset.bound){b.addEventListener('click',()=>showView(b.dataset.view));b.dataset.bound='1';}});const toggle=document.getElementById('mobile-menu-toggle');if(toggle&&!toggle.dataset.bound){toggle.addEventListener('click',toggleMobileMenu);toggle.dataset.bound='1';}window.addEventListener('resize',()=>{if(!mobileMode())closeMobileMenu();},{passive:true});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileMenu();});}
function showView(name){clearTimeout(advanceTimer);advanceTimer=null;view=name;document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===name));closeMobileMenu();if(name==='home')renderHome();else if(name==='calendar')renderCalendar();else if(name==='library')renderLibrary();else if(name==='account')renderAccount();else if(name==='teacher')renderTeacher();}
async function init(){bindGlobalUI();try{WORDS=await loadWordsData();if(WORDS.length!==2005||new Set(WORDS.map(x=>x.id)).size!==2005)throw new Error('官方字庫數量或ID不一致');WORDS_BY_ID=new Map(WORDS.map(w=>[w.id,w]));S=loadLocal(localKey);
 const c=window.VOCAB_CLOUD_CONFIG||{};if(c.url&&c.anonKey&&window.supabase?.createClient){supabase=window.supabase.createClient(c.url,c.anonKey);const {data:{session}}=await supabase.auth.getSession();if(session?.user)await handleLogin(session.user);}const params=new URLSearchParams(location.search);showView(params.get('view')==='calendar'?'calendar':'home');if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});
 }catch(e){ROOT.innerHTML=`<section class="panel"><h2>字庫載入失敗</h2><p>${esc(e.message)}</p><p>請確認 <code>index.html</code>、<code>app.js</code>、<code>styles.css</code>、<code>word-data-full.json</code> 與 <code>word-data-full.js</code> 都在同一個資料夾。</p><p>若放到網站伺服器（例如 GitHub Pages）可讀取 JSON；若是直接雙擊本機 HTML，系統會改用內建字庫。</p></section>`;console.error(e);}}
window.__VOCAB_TEST__={today,dateTaipei,addDays,diffDays,getWords:()=>WORDS,getState:()=>S,makePlan:startPlan,lightMetrics,groupOf,go:showView,login:handleLogin};
init();
})();

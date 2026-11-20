/* MeetMind AI API client — no secrets stored in source or GitHub Pages. */
(()=>{'use strict';
 const KEY='meetmind_api_base_v1',TOKEN='meetmind_api_token_v1';
 const $=id=>document.getElementById(id);
 const base=()=>String(localStorage.getItem(KEY)||'').trim().replace(/\/+$/,'');
 const token=()=>sessionStorage.getItem(TOKEN)||'';
 const setStatus=(s,good=false)=>{const n=$('apiConnectionStatus');if(n){n.textContent=s;n.className=good?'tag':'tag gray'}};
 async function request(path,opts={}){
  if(!base())throw new Error('Enter the deployed API URL first.');
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(token())headers.Authorization='Bearer '+token();
  const r=await fetch(base()+path,{...opts,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||('API request failed ('+r.status+')'));
  return data;
 }
 function panel(){
  if($('meetmindApiPanel'))return;
  const settings=$('settings');if(!settings)return;
  const wrap=document.createElement('div');wrap.className='panel';wrap.id='meetmindApiPanel';
  wrap.style.marginBottom='18px';
  wrap.innerHTML='<div class="panelhead"><h3>Live API connection</h3><span id="apiConnectionStatus" class="tag gray">Not connected</span></div>'+
   '<p class="muted small">Connect this web app to your deployed MeetMind API. Transcripts are sent only after you sign in.</p>'+
   '<div class="field"><label for="meetmindApiUrl">API base URL</label><input id="meetmindApiUrl" type="url" placeholder="https://your-worker.workers.dev" autocomplete="url"></div>'+
   '<div class="field"><label for="meetmindApiEmail">Account email</label><input id="meetmindApiEmail" type="email" autocomplete="username"></div>'+
   '<div class="field"><label for="meetmindApiPassword">Password</label><input id="meetmindApiPassword" type="password" autocomplete="current-password"></div>'+
   '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="meetmindApiLogin">Connect & sign in</button><button class="btn secondary" id="meetmindApiSync">Sync local meetings</button><button class="btn secondary" id="meetmindApiLogout">Sign out</button></div>'+
   '<p id="meetmindApiMessage" class="muted small" role="status" aria-live="polite"></p>';
  const grid=settings.querySelector('.settingsgrid');settings.insertBefore(wrap,grid||settings.firstChild);
  $('meetmindApiUrl').value=base();
  $('meetmindApiLogin').addEventListener('click',login);
  $('meetmindApiSync').addEventListener('click',syncAll);
  $('meetmindApiLogout').addEventListener('click',logout);
  $('meetmindApiUrl').addEventListener('change',()=>{localStorage.setItem(KEY,$('meetmindApiUrl').value.trim());setStatus('API URL saved')});
  if(token())checkSession();
 }
 const say=s=>{const n=$('meetmindApiMessage');if(n)n.textContent=s};
 async function login(){
  try{
   localStorage.setItem(KEY,$('meetmindApiUrl').value.trim());
   const email=$('meetmindApiEmail').value.trim(),password=$('meetmindApiPassword').value;
   if(!email||!password)throw new Error('Enter your account email and password.');
   setStatus('Connecting…');
   const d=await request('/api/v1/auth/login',{method:'POST',body:JSON.stringify({email,password})});
   sessionStorage.setItem(TOKEN,d.token);$('meetmindApiPassword').value='';
   setStatus('Signed in: '+d.user.email,true);say('Secure API session active.');await syncAll();
  }catch(e){setStatus('Connection failed');say(e.message)}
 }
 async function checkSession(){try{const d=await request('/api/v1/auth/me');setStatus('Signed in: '+d.user.email,true)}catch{sessionStorage.removeItem(TOKEN);setStatus('Sign in required')}}
 function logout(){sessionStorage.removeItem(TOKEN);setStatus('Signed out');say('API session ended. Local meetings remain on this device.')}
 function payload(m){return {id:m.id,title:m.title,meeting_date:m.createdAt||m.date,duration:m.duration,status:m.status,language:'mixed',transcript:m.transcript||[],minutes_en:m.minutes_en||'',minutes_si:m.minutes_si||''}}
 async function syncAll(){
  try{
   if(!token())throw new Error('Sign in before syncing.');
   const rows=Array.isArray(meetings)?meetings:[];
   let done=0;
   for(const m of rows){await request('/api/v1/meetings',{method:'POST',body:JSON.stringify(payload(m))});done++}
   setStatus('Connected · '+done+' meetings synced',true);say(done+' local meetings synchronized with your account.');
  }catch(e){setStatus('Sync failed');say(e.message)}
 }
 let liveMeetingId=null,apiQueue=Promise.resolve();
 function syncLive(status){
  if(!token()||!Array.isArray(currentTranscript)||!currentTranscript.length||!liveMeetingId)return;
  const snapshot={id:liveMeetingId,title:document.getElementById('meetingTitle')?.value||'Untitled meeting',createdAt:new Date().toISOString(),duration:document.getElementById('timer')?.textContent||'00:00',status,transcript:currentTranscript.map(x=>({...x}))};
  apiQueue=apiQueue.then(()=>request('/api/v1/meetings',{method:'POST',body:JSON.stringify(payload(snapshot))})).catch(e=>{say('API live sync error: '+e.message);throw e});
 }
 const originalStart=window.startRecording;
 if(typeof originalStart==='function')window.startRecording=function(){const result=originalStart.apply(this,arguments);if(recording){liveMeetingId='live-'+crypto.randomUUID();syncLive('In progress')}return result};
 const originalAdd=window.addTranscript;
 if(typeof originalAdd==='function')window.addTranscript=function(){const result=originalAdd.apply(this,arguments);syncLive('In progress');return result};
 const previous=window.saveMeetingRecord;
 if(typeof previous==='function'){
  window.saveMeetingRecord=function(){const result=previous.apply(this,arguments);const m=Array.isArray(meetings)?meetings[0]:null;if(m&&token()){const finalRecord={...m,id:liveMeetingId||m.id,status:'Completed'};apiQueue=apiQueue.then(()=>request('/api/v1/meetings',{method:'POST',body:JSON.stringify(payload(finalRecord))})).then(()=>say('Meeting saved to your account and this device.')).catch(e=>say('Local save succeeded; API sync failed: '+e.message))}liveMeetingId=null;return result}
 }
 window.MeetMindAPI={request,login,logout,syncAll,checkSession,get baseUrl(){return base()}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',panel,{once:true});else panel();
})();
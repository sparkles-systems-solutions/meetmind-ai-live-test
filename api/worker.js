const corsHeaders = (origin, env) => ({
  "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : "null",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Vary": "Origin",
  "Cache-Control": "no-store"
});
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {
  status, headers: {"Content-Type":"application/json; charset=utf-8", ...headers}
});
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const unb64u = value => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4)),c=>c.charCodeAt(0));
const uuid = () => crypto.randomUUID();
async function derive(password,salt){
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:210000,hash:"SHA-256"},key,256);
  return b64u(bits);
}
async function sign(payload,secret){
  const header=b64u(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const body=b64u(enc.encode(JSON.stringify(payload)));
  const data=header+"."+body;
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,enc.encode(data));
  return data+"."+b64u(sig);
}
async function verify(token,secret){
  try{
    const [h,p,s]=token.split(".");
    const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    if(!await crypto.subtle.verify("HMAC",key,unb64u(s),enc.encode(h+"."+p)))return null;
    const payload=JSON.parse(new TextDecoder().decode(unb64u(p)));
    if(!payload.exp||payload.exp<Date.now()/1000)return null;
    return payload;
  }catch{return null}
}
async function auth(req,env){
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return null;
  const claims=await verify(token,env.JWT_SECRET);
  if(!claims?.sub)return null;
  const user=await env.DB.prepare("SELECT id,email,role,is_active FROM users WHERE id=?").bind(claims.sub).first();
  return user&&user.is_active?user:null;
}
async function audit(env,user,action,id){
  await env.DB.prepare("INSERT INTO audit_log(id,user_id,action,resource_id) VALUES(?,?,?,?)")
    .bind(uuid(),user?.id||null,action,id||null).run();
}
function validEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254}
async function handle(req,env){
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,"")||"/";
  if(req.method==="GET"&&path==="/health")return json({ok:true,service:"MeetMind API",version:"1.0.0",database:!!env.DB});
  if(req.method==="POST"&&path==="/api/v1/auth/bootstrap"){
    if(!env.BOOTSTRAP_SECRET||req.headers.get("X-Bootstrap-Secret")!==env.BOOTSTRAP_SECRET)return json({error:"Forbidden"},403);
    const body=await req.json();
    const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
    if(!validEmail(email)||password.length<12)return json({error:"Valid email and password (minimum 12 characters) required"},400);
    const existing=await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    if(existing.n>0)return json({error:"Bootstrap is already completed"},409);
    const salt=crypto.getRandomValues(new Uint8Array(16)),hash=await derive(password,salt),id=uuid();
    await env.DB.prepare("INSERT INTO users(id,email,password_hash,password_salt,role) VALUES(?,?,?,?, 'admin')")
      .bind(id,email,hash,b64u(salt)).run();
    await audit(env,{id},"admin.bootstrap",id);
    return json({ok:true,message:"Admin account created. Remove or rotate BOOTSTRAP_SECRET now."},201);
  }
  if(req.method==="POST"&&path==="/api/v1/auth/login"){
    const body=await req.json(),email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
    const user=await env.DB.prepare("SELECT * FROM users WHERE email=? AND is_active=1").bind(email).first();
    if(!user)return json({error:"Invalid email or password"},401);
    const actual=await derive(password,unb64u(user.password_salt));
    if(actual!==user.password_hash)return json({error:"Invalid email or password"},401);
    const token=await sign({sub:user.id,role:user.role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+28800},env.JWT_SECRET);
    await audit(env,user,"auth.login",null);
    return json({ok:true,token,expiresIn:28800,user:{id:user.id,email:user.email,role:user.role}});
  }
  if(path==="/api/v1/auth/me"&&req.method==="GET"){
    const user=await auth(req,env);return user?json({user}):json({error:"Unauthorized"},401);
  }
  const user=await auth(req,env);
  if(!user)return json({error:"Unauthorized"},401);
  if(path==="/api/v1/meetings"&&req.method==="GET"){
    const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),100);
    const rows=await env.DB.prepare("SELECT id,title,meeting_date,duration,status,language,created_at,updated_at FROM meetings WHERE user_id=? ORDER BY meeting_date DESC LIMIT ?").bind(user.id,limit).all();
    return json({meetings:rows.results||[]});
  }
  if(path==="/api/v1/meetings"&&req.method==="POST"){
    const body=await req.json();
    const id=String(body.id||uuid()).slice(0,80),title=String(body.title||"Untitled meeting").trim().slice(0,200);
    const transcript=JSON.stringify(Array.isArray(body.transcript)?body.transcript:[]);
    if(transcript.length>900000)return json({error:"Transcript exceeds 900 KB limit"},413);
    await env.DB.prepare("INSERT INTO meetings(id,user_id,title,meeting_date,duration,status,language,transcript_json,minutes_en,minutes_si) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,meeting_date=excluded.meeting_date,duration=excluded.duration,status=excluded.status,language=excluded.language,transcript_json=excluded.transcript_json,minutes_en=excluded.minutes_en,minutes_si=excluded.minutes_si,updated_at=datetime('now') WHERE meetings.user_id=excluded.user_id")
      .bind(id,user.id,title,String(body.meeting_date||new Date().toISOString()).slice(0,40),String(body.duration||"").slice(0,40),String(body.status||"completed").slice(0,30),String(body.language||"mixed").slice(0,20),transcript,String(body.minutes_en||"").slice(0,100000),String(body.minutes_si||"").slice(0,100000)).run();
    await audit(env,user,"meeting.upsert",id);return json({ok:true,id},201);
  }
  if(path==="/api/v1/admin/overview"&&req.method==="GET"){
    if(user.role!=="admin")return json({error:"Forbidden"},403);
    const counts=await env.DB.prepare("SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM meetings) AS meetings,(SELECT COUNT(*) FROM audit_log) AS audit_events").first();
    return json({overview:counts});
  }
  if(path==="/api/v1/admin/users"&&req.method==="GET"){
    if(user.role!=="admin")return json({error:"Forbidden"},403);
    const rows=await env.DB.prepare("SELECT id,email,role,is_active,created_at FROM users ORDER BY created_at DESC LIMIT 200").all();
    return json({users:rows.results||[]});
  }
  const match=path.match(/^\/api\/v1\/meetings\/([A-Za-z0-9_-]+)$/);
  if(match){
    const id=match[1];
    if(req.method==="GET"){
      const row=await env.DB.prepare("SELECT * FROM meetings WHERE id=? AND user_id=?").bind(id,user.id).first();
      if(!row)return json({error:"Not found"},404);
      return json({meeting:{...row,transcript:JSON.parse(row.transcript_json||"[]")}});
    }
    if(req.method==="DELETE"){
      const result=await env.DB.prepare("DELETE FROM meetings WHERE id=? AND user_id=?").bind(id,user.id).run();
      if(!result.meta.changes)return json({error:"Not found"},404);
      await audit(env,user,"meeting.delete",id);return json({ok:true});
    }
    if(req.method==="PUT"){
      const body=await req.json(),transcript=JSON.stringify(Array.isArray(body.transcript)?body.transcript:[]);
      if(transcript.length>900000)return json({error:"Transcript exceeds 900 KB limit"},413);
      const result=await env.DB.prepare("UPDATE meetings SET title=?,duration=?,status=?,transcript_json=?,minutes_en=?,minutes_si=?,updated_at=datetime('now') WHERE id=? AND user_id=?")
        .bind(String(body.title||"Untitled meeting").slice(0,200),String(body.duration||"").slice(0,40),String(body.status||"completed").slice(0,30),transcript,String(body.minutes_en||"").slice(0,100000),String(body.minutes_si||"").slice(0,100000),id,user.id).run();
      if(!result.meta.changes)return json({error:"Not found"},404);
      await audit(env,user,"meeting.update",id);return json({ok:true,id});
    }
  }
  return json({error:"Not found"},404);
}
export default {
  async fetch(req,env){
    const origin=req.headers.get("Origin")||"";
    const headers=corsHeaders(origin,env);
    if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
    if(origin!==env.ALLOWED_ORIGIN)return json({error:"Origin not allowed"},403,headers);
    try{return await handle(req,env).then(res=>{const h=new Headers(res.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);return new Response(res.body,{status:res.status,headers:h})})}
    catch(e){return json({error:"Internal server error",requestId:uuid()},500,headers)}
  }
};

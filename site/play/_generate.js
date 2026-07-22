// iDoris 生成类卡片共享逻辑（ten-minute-website / kids-art-gallery / sentence-to-game）
// 描述 → /api/chat(Workers AI) 生成自包含 HTML → 隔离沙箱 iframe 预览。
// 安全：生成的 HTML 全部塞进 sandbox iframe（无 allow-same-origin，碰不到本站数据/钱包）；
//       代码视图与状态文本一律 textContent，绝不把动态内容拼进 innerHTML。
(function(){
  var C = window.__card || {}; var I18N = C.I18N || {}; var SYS = C.SYS || ""; var MAXTOK = C.maxTokens || 2048;
  var lang = "en", W = null, busy = false, lastHtml = "";
  function q(s){return document.querySelector(s);} function qa(s){return document.querySelectorAll(s);}
  function d(){ return I18N[lang] || I18N.en || {}; }
  function wallet(){ var w=null; try{w=localStorage.getItem('idoris_wallet');}catch(e){}
    if(!/^[a-f0-9]{12,40}$/.test(w||'')){ w=(crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):(Date.now().toString(16)+Math.floor(Math.random()*1e12).toString(16))).slice(0,24); try{localStorage.setItem('idoris_wallet',w);}catch(e){} } return w; }
  W = wallet();
  try{ var ul=new URLSearchParams(location.search).get("lang"); if(ul&&I18N[ul]) lang=ul; }catch(e){}

  function renderChips(){
    var arr=d().chips||[];
    q("#chips").textContent="";
    arr.forEach(function(c){ var b=document.createElement("button"); b.textContent=c; b.onclick=function(){ q("#prompt").value=c; }; q("#chips").appendChild(b); });
  }
  function applyLang(){
    var t=d();
    qa("[data-i]").forEach(function(el){ var k=el.getAttribute("data-i"); if(t[k]!=null) el.innerHTML=t[k]; });
    qa("[data-i-ph]").forEach(function(el){ var k=el.getAttribute("data-i-ph"); if(t[k]!=null) el.placeholder=t[k]; });
    document.documentElement.lang=lang;
    qa(".lang button").forEach(function(b){ b.classList.toggle("on", b.getAttribute("data-l")===lang); });
    renderChips();
  }
  qa(".lang button").forEach(function(b){ b.onclick=function(){ lang=b.getAttribute("data-l"); applyLang(); loadBal(); }; });

  function loadBal(){ fetch('/api/balance?code='+encodeURIComponent(W)).then(function(r){return r.json();}).then(function(x){ if(!busy) q("#status").textContent=d().bal.replace("%s",(x.remaining||0).toLocaleString()); }).catch(function(){}); }

  function extractHtml(s){
    s=String(s||"").trim();
    var m=s.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if(m) return m[1].trim();
    var i=s.search(/<!doctype|<html|</i);
    return i>=0 ? s.slice(i) : s;
  }
  function showTab(which){
    var prev=which==="preview";
    q("#frame").style.display=prev?"block":"none";
    q("#code").style.display=prev?"none":"block";
    q("#tPrev").classList.toggle("on",prev); q("#tCode").classList.toggle("on",!prev);
  }
  q("#tPrev").onclick=function(){ showTab("preview"); };
  q("#tCode").onclick=function(){ showTab("code"); };

  q("#dl").onclick=function(){
    if(!lastHtml) return;
    var blob=new Blob([lastHtml],{type:"text/html"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="idoris-page.html";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
  };

  q("#go").onclick=async function(){
    if(busy) return;
    var desc=(q("#prompt").value||"").trim();
    if(!desc){ q("#status").textContent=d().empty; return; }
    busy=true; q("#go").disabled=true;
    q("#veil").style.display="none";
    q("#spin").style.display="flex"; q("#status").textContent=d().gen||"…";
    try{
      var r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({code:W, maxTokens:MAXTOK, messages:[{role:"system",content:SYS},{role:"user",content:desc.slice(0,1500)}]})});
      var x=await r.json();
      if(!r.ok){ q("#spin").style.display="none"; q("#veil").style.display="flex"; q("#veil").textContent=(x.error==='insufficient'||x.error==='no_wallet')?d().needTop:d().err; busy=false; q("#go").disabled=false; loadBal(); return; }
      var html=extractHtml(x.reply);
      lastHtml=html;
      // 关键安全点：动态生成的 HTML 只通过 srcdoc 进隔离沙箱 iframe（无 allow-same-origin）
      q("#frame").srcdoc=html;
      q("#code").textContent=html;          // 代码视图用 textContent，安全
      q("#dl").style.display="inline";
      showTab("preview");
      q("#status").textContent=d().done.replace("%s",x.spent).replace("%s",(x.remaining||0).toLocaleString());
    }catch(e){ q("#spin").style.display="none"; q("#veil").style.display="flex"; q("#veil").textContent=d().err; }
    q("#spin").style.display="none";
    busy=false; q("#go").disabled=false;
  };

  applyLang(); loadBal();
})();

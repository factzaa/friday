/* Friday Service Worker — network-first สำหรับหน้าเว็บ (เห็นอัปเดตทันที) + แคชไฟล์คงที่ไว้เปิดไว
   (หน้า .html = ลองเน็ตก่อนเสมอ · วิดีโอหมี/ฟอนต์/ไลบรารี = stale-while-revalidate) */
var CACHE = "friday-shell-v3";
var SHELL = ["live.html", "bear.mp4", "bear.png", "index.html"];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL).catch(function(){}); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(Promise.all([
    caches.keys().then(function(keys){ return Promise.all(keys.map(function(k){ return k===CACHE ? null : caches.delete(k); })); }),
    self.clients.claim()
  ]));
});

function isShell(url){
  if(url.origin === self.location.origin) return true;                 // live.html, bear.mp4, bear.png (GitHub Pages)
  if(url.host === "esm.sh") return true;                               // ไลบรารี Gemini SDK
  if(url.host === "fonts.googleapis.com") return true;
  if(url.host === "fonts.gstatic.com") return true;
  return false;
}
function isDynamic(url){
  var h = url.host;
  if(h.indexOf("supabase.co") >= 0) return true;
  if(h.indexOf("generativelanguage.googleapis.com") >= 0) return true;
  if(h.indexOf("googleapis.com") >= 0 && h !== "fonts.googleapis.com") return true;
  if(h.indexOf("open-meteo.com") >= 0) return true;
  if(h.indexOf("bigdatacloud.net") >= 0) return true;
  return false;
}
/* หน้าเว็บของแอป (ต้องเห็นอัปเดตทันที) */
function isHtml(url, req){
  return req.mode === "navigate" || /\.html($|\?)/.test(url.pathname) || url.pathname === "/" || url.pathname.endsWith("/");
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;                 // POST/PUT (API) ปล่อยผ่าน
  var url;
  try{ url = new URL(req.url); }catch(err){ return; }
  if(isDynamic(url)) return;                        // ของสด ปล่อยผ่านเน็ตปกติ
  if(!isShell(url)) return;

  /* หน้า .html = network-first: ลองโหลดจากเน็ตก่อนเสมอ → เห็นตัวล่าสุดทันที · ออฟไลน์ค่อยใช้แคช */
  if(isHtml(url, req)){
    e.respondWith(
      fetch(req, { cache: "no-store" }).then(function(res){
        if(res && (res.ok || res.type === "opaque")){ caches.open(CACHE).then(function(c){ c.put(req, res.clone()); }); }
        return res;
      }).catch(function(){
        return caches.open(CACHE).then(function(c){ return c.match(req).then(function(m){ return m || c.match("live.html"); }); });
      })
    );
    return;
  }

  /* ไฟล์คงที่อื่น (วิดีโอ/ฟอนต์/ไลบรารี) = stale-while-revalidate: เร็ว + อัปเดตเบื้องหลัง */
  e.respondWith(
    caches.open(CACHE).then(function(cache){
      return cache.match(req).then(function(cached){
        var net = fetch(req).then(function(res){
          if(res && (res.ok || res.type === "opaque")){ cache.put(req, res.clone()); }
          return res;
        }).catch(function(){ return cached; });
        return cached || net;
      });
    })
  );
});

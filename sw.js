/* Friday Service Worker — hybrid: โหลดจากแคชก่อนให้เปิดไว + อัปเดตจาก GitHub เบื้องหลัง
   (stale-while-revalidate สำหรับ "เปลือกแอป" เท่านั้น ไม่แตะ API/เสียงสด) */
var CACHE = "friday-shell-v1";
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

/* จะแคชเฉพาะไฟล์คงที่ของแอป (หน้าเว็บ, วิดีโอหมี, ไลบรารี, ฟอนต์) */
function isShell(url){
  if(url.origin === self.location.origin) return true;                 // live.html, bear.mp4, bear.png (GitHub Pages)
  if(url.host === "esm.sh") return true;                               // ไลบรารี Gemini SDK
  if(url.host === "fonts.googleapis.com") return true;
  if(url.host === "fonts.gstatic.com") return true;
  return false;
}
/* ห้ามแคชเด็ดขาด: token, ฐานข้อมูล, Tuya, Gemini API, อากาศ, พิกัด */
function isDynamic(url){
  var h = url.host;
  if(h.indexOf("supabase.co") >= 0) return true;
  if(h.indexOf("generativelanguage.googleapis.com") >= 0) return true;
  if(h.indexOf("googleapis.com") >= 0 && h !== "fonts.googleapis.com") return true;
  if(h.indexOf("open-meteo.com") >= 0) return true;
  if(h.indexOf("bigdatacloud.net") >= 0) return true;
  return false;
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;                 // POST/PUT (API) ปล่อยผ่าน
  var url;
  try{ url = new URL(req.url); }catch(err){ return; }
  if(isDynamic(url)) return;                        // ของสด ปล่อยผ่านเน็ตปกติ
  if(!isShell(url)) return;
  /* stale-while-revalidate: ส่งจากแคชทันที (เร็ว) แล้วอัปเดตแคชเบื้องหลังให้รอบหน้าใหม่ */
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

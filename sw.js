/* MUÑIZ Pedidos - service worker: offline app shell + instant load (fully self-contained) */
const CACHE = "muniz-pedidos-v29";
const SHELL = [
  "./","./index.html","./app.js","./styles.css","./manifest.json","./config.js","./catalog_ace.json","./catalog_cmc.json","./fotos_ace.json","./fotos_cmc.json","./catalog_rss.json","./fotos_rss.json","./catalog_whitecap.json","./fotos_whitecap.json",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png"
];
self.addEventListener("install",(e)=>{e.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  await Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})));
  self.skipWaiting();
})());});
self.addEventListener("activate",(e)=>{e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  self.clients.claim();
})());});
self.addEventListener("fetch",(e)=>{
  const req=e.request; if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin===location.origin){
    e.respondWith((async()=>{
      const cached=await caches.match(req);
      const net=fetch(req).then(res=>{if(res&&res.status===200)caches.open(CACHE).then(c=>c.put(req,res.clone()));return res;}).catch(()=>cached);
      return cached||net;
    })());
    return;
  }
  // product photos (remote): try network, fall back to cache, else emoji placeholder handles it
  e.respondWith((async()=>{
    try{const res=await fetch(req);
      if(res&&res.status===200) caches.open(CACHE).then(c=>c.put(req,res.clone()));
      return res;
    }catch(err){const cached=await caches.match(req);return cached||Response.error();}
  })());
});

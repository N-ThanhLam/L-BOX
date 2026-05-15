// ════════════════════════════════════════════════════════
//  L-BOX Service Worker
//  目的:
//   ① アプリシェル（HTML/CSS/JS）をオフラインキャッシュして
//      Brave Android がタブを discard した後の再起動を瞬時にする
//   ② Service Worker 登録された PWA は OS から "installed app" 扱いされ、
//      バックグラウンド時の discard 対象から外れやすくなる
//
//  方針: Stale-While-Revalidate
//   - キャッシュがあれば即座に返す（オフライン/discard 復帰時の高速起動）
//   - 同時にネットワークから新版を取りに行ってキャッシュを更新する
//   - 次回アクセス時に新版が反映される（ユーザーは1テンポ遅れて新版を見る）
// ════════════════════════════════════════════════════════

const CACHE = 'lbox-v1';

// install 時に明示的に取りにいく最小セット。
// HTML 本体のファイル名は環境（index.html / jukebox.html 等）で変わるため
// './' のリクエストでサーバが返すデフォルトドキュメントに任せる。
const PRECACHE = [
  './',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => null))   // 1個失敗しても続行
  );
  self.skipWaiting();   // 既存 SW を即置き換える
});

self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    // 旧バージョンのキャッシュを掃除
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )),
    self.clients.claim()   // 既存タブも即座に新 SW の管轄下に
  ]));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // 同一オリジンのみキャッシュ対象（外部 CDN 等は素通し）
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // blob: / data: は対象外
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(resp => {
        // 成功レスポンスだけキャッシュ更新（opaque やエラーは捨てる）
        if (resp && resp.ok && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);   // オフラインならキャッシュにフォールバック

      // キャッシュがあれば即返し、無ければネットワーク待ち
      return cached || networkFetch;
    })
  );
});

// ページ側から「強制再取得して」要求が来た時の入口（任意）
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

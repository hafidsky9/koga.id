# Koga: backend tahap 3

Node.js 20 + Express + SQLite. Satu kontainer aplikasi, plus coturn opsional, melayani API dan dua halaman:
`/` (aplikasi, dari `public/index.html`) dan `/admin.html` (panel admin).

## Jalankan di STB (Armbian + CasaOS)

Butuh Docker dan Docker Compose (sudah ada di CasaOS).

```bash
cd koga
cp .env.example .env
nano .env                                  # isi SESSION_SECRET, ADMIN_USER, ADMIN_PASS, BASE_URL
mkdir -p data uploads
sudo chown -R 1000:1000 data uploads       # kontainer jalan sebagai user "node" (uid 1000)
docker compose up -d --build
docker compose logs -f                     # harus ada: Admin "..." dibuat, Koga jalan di port 3000
```

Buka alamat Koga sesuai `BASE_URL`. HTTP lokal boleh untuk fungsi tahap 1/2, tetapi voice dan kamera memerlukan HTTPS (kecuali localhost). Panel admin: `/admin.html`.
Build pertama di arm64 bisa beberapa menit (kompilasi paket native bila tidak ada prebuilt).

## Data dan cadangan

- `data/koga.db`: akun, konten, sesi. `uploads/`: gambar.
- Cadangan: hentikan kontainer (`docker compose stop`), salin `data/` dan `uploads/`, lalu `docker compose start`.
- Ganti password admin: belum ada fitur. Admin hanya dibuat saat belum ada admin. Untuk ganti, hapus baris admin di `data/koga.db` lalu ubah `ADMIN_PASS` dan start ulang.

## HTTPS

Tanpa HTTPS cookie sesi dikirim lewat HTTP biasa. Aman untuk LAN, bukan untuk internet terbuka.
Untuk internet, pasang reverse proxy HTTPS di depan Koga, lalu isi `TRUST_PROXY=1` di `.env`.

## Tes

```bash
npm ci
npm run smoke      # menjalankan server sementara dengan DB sementara, menembak API lewat HTTP
```

## API

| Endpoint | Akses |
|---|---|
| `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me` | publik / sesi |
| `GET /api/feed?type=`, `/api/games`, `/api/tournaments?game=`, `/api/matches?game=&tour=&status=`, `/api/content/:id` | publik, baca saja |
| `GET/POST /api/admin/content`, `PUT/DELETE /api/admin/content/:id` | admin |

## Tahap 2 — Sosial dan komunitas

Tahap 2 menambahkan migrasi skema v2 tanpa menghapus tabel atau data tahap 1.
WAL dan foreign keys tetap aktif. Satu proses Node.js tetap digunakan.

### Upgrade dari tahap 1 (jangan hapus database)

1. Hentikan kontainer: `docker compose stop`.
2. Salin **seluruh** `data/` dan `uploads/` serta `.env` ke lokasi cadangan yang aman.
   Salin direktori setelah kontainer berhenti, termasuk file SQLite `-wal`/`-shm` jika ada.
3. Ekstrak kode tahap 2 ke direktori terpisah, lalu salin berkas program dari sana
   ke direktori Koga lama. **Jangan timpa `.env`, `data/`, atau `uploads/`.**
4. Jalankan `docker compose up -d --build` dan `docker compose logs -f`.
   Migrasi `user_version=1 → 2` berjalan otomatis dalam transaksi saat proses pertama start.
5. Uji `npm ci && npm run smoke` pada mesin dengan Node.js 20+ dan akses npm.
   Smoke membuat database sementara, tidak memakai database produksi.
6. Uji manual dua akun browser sebelum digunakan di produksi.

Rollback: stop kontainer, pulihkan kode tahap 1 **dan** salinan data sebelum upgrade;
jangan menjalankan tahap 1 langsung pada DB v2 karena kolom tag kini wajib pada insert.
Rollback dari backup akan menghilangkan transaksi yang terjadi setelah waktu backup.

Jalankan lokal tanpa Docker: `npm ci`, isi environment (misalnya `cp .env.example .env`,
lalu isi rahasia), `node --env-file=.env server.js`. Gunakan Node 20.6+ untuk flag tersebut;
`npm start` juga bisa digunakan setelah environment diekspor ke proses. Jangan masukkan `.env` ke frontend.

### REST tahap 2

Semua endpoint berikut wajib login; mutasi REST tetap menggunakan pemeriksaan Origin CSRF tahap 1.
Respons kesalahan tetap `{ "error": "pesan" }`. ID pada URL harus angka positif.
Semua daftar baru memakai `?limit=50&offset=0` (maksimal 100, `nextOffset` null jika habis).
Daftar pesan memakai `?before=<id>&limit=50` dan `nextBefore`; item dalam satu halaman berurutan lama → baru.

| Endpoint | Keterangan / body JSON |
|---|---|
| `GET /api/me` | Tambahan `user.tag` (string angka 7 digit), `user.status_text` |
| `POST /api/me/status` | `{status_text}`; maksimal 100 karakter, kosong untuk menghapus |
| `GET /api/friends` | `items`, `groups: {in_game,online,offline}`, `nextOffset`; idle dikelompokkan online |
| `POST /api/friends/request` | `{tag}`; boleh dengan atau tanpa `#` |
| `GET /api/friends/requests` | Permintaan masuk yang belum diputuskan |
| `POST /api/friends/requests/:id/accept` | Hanya penerima permintaan |
| `POST /api/friends/requests/:id/decline` | Hanya penerima permintaan |
| `DELETE /api/friends/:id` | `:id` = ID user teman; menghapus relasi dua arah, bukan histori |
| `GET /api/dms` | Daftar teman yang memiliki DM, isi dan waktu pesan terakhir |
| `GET /api/dms/:userId/messages` | Histori dua teman; cursor pagination |
| `GET /api/templates` | Template bawaan `gaming`, `hobby`, `community`, `blank` dari seed konfigurasi server |
| `POST /api/servers` | `{name,template,kind}`, kind `friends`/`community`; owner otomatis anggota |
| `GET /api/servers` | Server keanggotaan, kode undangan, jumlah unread |
| `POST /api/servers/join` | `{code}`; join yang diulang bersifat idempoten |
| `GET /api/servers/:id/channels` | Anggota; kategori, posisi, tipe, unread |
| `POST /api/servers/:id/channels` | Owner; `{name,category,type}` dengan tipe `text`/`voice`, posisi otomatis |
| `GET /api/channels/:id/messages` | Hanya anggota, kanal teks; cursor pagination |

Format tag disimpan tanpa `#`. Invite code berupa 12 karakter base64url acak.
Unread kanal menghitung pesan orang lain setelah `last_msg_id`; gabungan unread kanal menjadi badge server.
Anggota baru dapat membaca histori yang sudah ada. Undangan berlaku sampai data server dihapus (tidak ada fitur rotasi pada tahap ini).
Setelah pertemanan dihapus, histori DM tetap tersimpan tetapi tidak dapat dibaca sampai berteman kembali.

### WebSocket

`ws://HOST/ws` atau `wss://HOST/ws` menggunakan cookie `koga.sid`, bukan token di JavaScript.
Origin harus sama dengan host dan skema HTTP(S), atau sesuai `ALLOWED_ORIGINS`.
Untuk reverse proxy HTTPS, teruskan header `Host`, `X-Forwarded-Proto`, `Upgrade`, `Connection` dan atur `TRUST_PROXY=1` hanya pada proxy tepercaya.

Contoh frame JSON klien (flat, `requestId` opsional untuk ack/error):

```json
{"type":"message.send","channelId":12,"body":"Halo @budi","replyTo":null,"requestId":"send1"}
{"type":"message.send","dmUserId":2,"body":"Halo","requestId":"send2"}
{"type":"reaction.toggle","messageId":7}
{"type":"reaction.toggle","scope":"dm","messageId":7}
{"type":"read.mark","channelId":12,"lastMsgId":7}
{"type":"presence.set","state":"idle"}
```

Server mengirim `message.new` (`scope`, `message`, dan `channelId`/`serverId` untuk kanal),
`reaction.update` (`scope`, `messageId`, `count`, `reacted`, `userId`), `presence.update`
(`userId`, `presence`, `status_text`), `friend.request` (`action`, `id`, `userId`),
serta `ack`/`error` dengan `requestId` jika disertakan. Error mengandung `status` dan `error`.
`presence.set` menerima `online`/`idle`; klien menandai idle setelah 5 menit tidak aktif.
Status game berasal dari format `Bermain - Nama Game`; jika seluruh koneksi idle, idle didahulukan.
Presence dan koneksi tersimpan di memori, bukan DB. Mention menyimpan username valid yang berada
pada percakapan yang berhak diakses, bukan HTML. Reaksi jempol juga didukung di DM menggunakan `scope:dm`.

Batas WebSocket: payload 16 KiB, 5 percobaan `message.send` per detik per koneksi,
30 event JSON selain voice.signal per detik per koneksi, pesan trim 1–2000 Unicode code points, ping/pong 30 detik.
Koneksi ditutup saat logout/sesi kedaluwarsa, atau klien lambat melebihi batas buffer 256 KiB.
Tidak ada antrean pengiriman offline atau deduplikasi pesan lintas reconnect.

### Penggunaan UI

- Sosial → Teman: pencarian, kelompok status dan filter melalui menu Lainnya; klik teman membuka DM.
- Sosial → Pesan: tombol pesan baru kembali ke daftar teman agar memilih penerima.
- Sosial → Permintaan: Salin ID, Tambahkan Teman, Terima/Tolak. Dialog input dipakai agar tidak menambah layout.
- Komunitas: pilih server di rail, klik nama server untuk menyalin kode, pilih kanal teks; ikon + untuk buat/gabung.
- Chat: Enter atau ikon kirim, Balas (Esc untuk batal), tombol jempol, gulir atas untuk histori sebelumnya.
- Profil: Atur Status menerima teks biasa atau `Bermain - Nama Game`.
- Tombol Muat lagi tersedia untuk daftar lebih panjang; filter/pencarian hanya pada item yang sudah dimuat.
- Sejak tahap 3, QR dan voice berfungsi sesuai bagian berikut. Tidak ada upload gambar di chat atau push.

### Dependensi dan verifikasi

Satu dependency baru: `ws` 8.21.3, dipasang untuk WebSocket server dan klien smoke test;
frontend memakai WebSocket bawaan browser. Versi dipin dan integrity dicantumkan di lockfile.
Tidak ada dependency frontend baru. `npm ci` tetap menjadi jalur instalasi.

**Riwayat:** laporan serah terima tahap 2 tercantum di `LAPORAN-TAHAP-2.md`. Pengguna melaporkan tahap 1 dan 2 telah lulus smoke test pada lingkungan target. Status verifikasi tahap 3 dicatat tersendiri di bawah.

## Tahap 3 — Voice dan QR teman

Voice menggunakan mesh P2P WebRTC audio, signaling melalui `/ws` yang sudah ada, maksimal lima peserta (maksimal empat peer connection di setiap browser). Audio tidak disimpan atau diproses oleh Node.js; TURN opsional merelay paket WebRTC bila ICE langsung tidak dapat tersambung. Keanggotaan voice dan roster bersifat sementara di memori. Skema SQLite tetap v2, **tidak ada migrasi atau tabel baru**.

### Upgrade dari tahap 2

1. Hentikan aplikasi: `docker compose stop`. Backup seluruh `data/`, `uploads/`, `.env` dan source tahap 2.
2. Ekstrak paket tahap 3 terpisah. Salin source program, termasuk `scripts/`, `public/vendor/`, `Dockerfile`, `docker-compose.yml` dan lockfile; jangan timpa `.env`, `data/`, `uploads/` produksi. Baca variabel baru dalam `.env.example` dan tambahkan ke `.env` lama secara manual.
3. Pada mesin dengan Node.js 20+ dan akses npm, jalankan:

   ```bash
   npm ci
   npm run test:voice
   npm run smoke
   ```

   Smoke memakai database sementara, seluruh tes lama, serta tujuh akun untuk skenario kapasitas voice, isolasi relay, ICE dan QR. `test:voice` adalah unit test state machine dan ICE tanpa media. `npm ci` juga menyalin decoder jsQR resmi ke `public/vendor/jsQR.js` dan lisensinya. Jangan menjalankan instalasi dengan `--ignore-scripts`; bila harus, jalankan `node scripts/vendor-qr.js` setelah instalasi. Pastikan tes berhasil sebelum deployment.
4. Jalankan `docker compose up -d --build` (tanpa TURN) atau perintah profile TURN di bawah. Buka alamat HTTPS, cek log, lanjutkan tes manual media.

Rollback: hentikan kontainer, pulihkan source tahap 2, dan jalankan ulang build. DB v2 tidak berubah skemanya dan permintaan teman yang dibuat melalui QR tetap kompatibel dengan tahap 2. Backup tetap dianjurkan; memulihkan snapshot lama menghilangkan data baru.

### Environment dan HTTPS

Tambahkan ke `.env` lama; contoh berikut memakai domain ilustrasi, ganti dengan domain Anda:

```dotenv
BASE_URL=https://koga.contoh.id
TRUST_PROXY=1
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=
TURN_SECRET=
TURN_EXTERNAL_IP=
```

`BASE_URL` harus berupa origin kanonik yang bisa dibuka pengguna (tanpa path, query, atau fragment). QR dari origin lain ditolak scanner. Jika kosong atau salah, endpoint QR gagal dengan pesan konfigurasi; fungsi tahap 1/2 tetap dapat dipakai. Di balik reverse proxy, aktifkan HTTPS dan dukungan upgrade WebSocket. Gunakan `TRUST_PROXY` hanya pada proxy tepercaya. Jangan membuka port HTTP Koga ke internet tanpa pengamanan. `getUserMedia` membutuhkan secure context: `http://IP-STB` bukan HTTPS, meski perangkat berada di Wi-Fi yang sama. `http://localhost` dapat dipakai untuk pengembangan di perangkat yang sama. Mikrofon dan kamera juga perlu izin browser/OS.

### Tanpa coturn (STUN saja)

```bash
docker compose up -d --build
docker compose logs -f koga
```

Cocok untuk mencoba voice di LAN. Tanpa TURN, koneksi antar rumah/seluler bisa gagal pada sebagian NAT, firewall atau CGNAT. HTTPS untuk halaman aplikasi **tidak** menyelesaikan masalah NAT media.

### Dengan coturn opsional (profile `turn`)

Buat secret acak dengan `openssl rand -hex 32`. Jangan gunakan contoh sebagai secret produksi. Pada `.env` Koga, set:

```dotenv
TURN_URL=turn:turn.contoh.id:3478?transport=udp,turn:turn.contoh.id:3478?transport=tcp
TURN_SECRET=ISI_DENGAN_SECRET_ACAK
# Contoh NAT; ganti dengan IP publik dan IP LAN aktual host TURN:
TURN_EXTERNAL_IP=203.0.113.10/192.168.1.20
```

Satu URL atau beberapa URL yang dipisahkan koma didukung. `TURN_EXTERNAL_IP` adalah IP publik atau `publicIP/privateIP` untuk host di balik NAT. Jika VPS memiliki IP publik langsung, isi IP publik tersebut atau kosongkan jika alamat relay publik sudah benar. `turn.contoh.id` harus resolve langsung ke IP host TURN, bukan sekadar HTTP tunnel/proxy/CDN. Aplikasi dan coturn harus memakai secret yang sama. Sinkronkan jam server (NTP).

```bash
docker compose --profile turn up -d --build
docker compose --profile turn logs -f coturn
# bila ingin menonaktifkan TURN lokal:
docker compose --profile turn stop coturn
# kosongkan TURN_URL/TURN_SECRET di .env lalu recreate Koga
```

Service memakai image `coturn/coturn:4.19.1`, `network_mode: host` (Linux STB/VPS), mode `use-auth-secret`, `--static-auth-secret`, realm `koga`, UDP relay dan kuota total 40 allocation. Kuota per username tidak dipakai karena kredensial berbasis timestamp dapat sama bagi pengguna yang mengambil konfigurasi pada detik yang sama. Tidak ada port tambahan dalam `ports:` karena host network langsung menggunakan port host.

| Port | Protokol | Keterangan |
|---|---|---|
| 3478 | UDP dan TCP | STUN/TURN client |
| 49152–49200 | UDP | Relay media WebRTC |

Buka firewall host dan forward kedua rentang tersebut pada router ke host TURN, dengan port eksternal sama. Relay TCP antarpeserta, TURN TLS/DTLS (5349), CLI admin dan multicast tidak diaktifkan; koneksi TURN client lewat TCP 3478 tetap didukung. Daftar deny IP private, loopback dan link-local mengurangi risiko TURN dipakai sebagai relay ke layanan LAN. Jangan menghapus deny rules tanpa memahami akibatnya. Cek konfigurasi dan log image pada perangkat target; tag image sudah dipilih dari daftar resmi, tetapi belum ditarik/dijalankan di lingkungan pengerjaan.

Jika STB berada di balik CGNAT atau ISP tidak mengizinkan port forwarding, jalankan coturn di VPS Linux murah yang memiliki IP publik dan buka port tersebut di firewall VPS. Isi `TURN_URL` ke domain/IP VPS dan secret yang sama di Koga; jalankan Koga tanpa profile `turn` pada STB. Jika memakai compose pada VPS untuk coturn saja, salin konfigurasi dan jalankan `docker compose --profile turn up -d coturn` dengan `.env` khusus TURN. Tidak perlu memindahkan SQLite/Koga. TURN menambah bandwidth dan biaya transfer VPS; 49 port relay/kuota cukup untuk pengujian kecil, bukan jaminan kapasitas banyak room.

### REST tahap 3

| Endpoint | Keterangan |
|---|---|
| `GET /api/rtc-config` | Login. `{iceServers:[...]}`. STUN default; TURN username berupa epoch expiry +3600 detik, credential HMAC-SHA1 base64, tidak mengirim secret. |
| `GET /api/me/invite` | Login. URL kanonik akun sendiri, `{url}`. |
| `GET /api/me/qr.svg` | Login. SVG QR yang memuat URL undangan akun sendiri; no-store. |
| `GET /add/:tag` | Navigasi undangan. Tanpa sesi: redirect `/?add=TAG` untuk login lalu kembali ke URL tetap. Dengan sesi: target diverifikasi, permintaan dibuat, redirect `/?invite=sent`; duplikat/sudah berteman → `pending`, diri sendiri → `self`; tag asing → 404. |
| `GET /api/servers/:id/channels` | Kontrak lama ditambah `users` pada kanal voice, hanya anggota. |

Undangan GET memicu mutasi **karena kebutuhan tahap 3**; HEAD, prefetch dan request subresource yang teridentifikasi ditolak. Risiko yang tersisa: navigasi top-level lintas situs masih dapat memicu permintaan jika sesi sudah login. Penerima tetap harus menyetujui; tidak otomatis menjadi teman. Untuk deployment dengan kebijakan CSRF ketat, perubahan kontrak ke layar konfirmasi + POST diperlukan di luar cakupan ini. Pemindai dalam Koga memakai POST yang dilindungi CSRF, bukan mengikuti URL hasil pindai. Tidak ada open redirect; URL kelanjutan ditetapkan server. Tag bukan rahasia dan tidak memberikan hak akses.

### Protokol voice WebSocket

Event masuk, bentuk JSON flat seperti tahap 2:

```json
{"type":"voice.join","channelId":12,"requestId":"voiceJoin1"}
{"type":"voice.signal","channelId":12,"to":2,"peerId":"ID-dari-peer","data":{"type":"offer","sdp":"..."}}
{"type":"voice.signal","channelId":12,"to":2,"data":{"type":"candidate","candidate":"...","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"..."}}
{"type":"voice.state","channelId":12,"muted":true}
{"type":"voice.leave","channelId":12}
```

`channelId` pada join wajib; pada signal/state/leave opsional untuk kompatibilitas spesifikasi, dan diverifikasi bila dikirim. `to` merupakan ID user; `peerId` opsional adalah identitas koneksi voice yang baru pada setiap join, digunakan frontend untuk mencegah sinyal lama ke tab/koneksi lain. Hanya pengirim/penerima satu kanal dan anggota sah yang boleh bertukar sinyal. Signal hanya menerima data SDP offer/answer atau ICE candidate; envelope seluruhnya maksimum 16 KiB seperti tahap 2. Batas `voice.signal` 60 percobaan/detik/koneksi, event lain tetap 30/detik dan chat tetap 5 pesan/detik. Error 409 untuk kanal penuh, 403 untuk akses tidak sah. Tidak ada server WS baru.

| Event keluar | Data utama |
|---|---|
| `voice.peers` | `channelId`, `self`, `peers` (peserta lama) |
| `voice.peer-joined` | `channelId`, `user` |
| `voice.peer-left` | `channelId`, `userId`, `peerId` |
| `voice.signal` | `channelId`, `from`, `peerId`, `data` |
| `voice.state` | `channelId`, `userId`, `peerId`, `muted` |
| `voice.roster` | `channelId`, `users`; broadcast hanya anggota server |
| `voice.left` | `channelId`, `reason`; tambahan untuk memberi tahu tab lama jika akun join dari perangkat/tab lain |

Objek peserta memuat `id`, `username`, `muted`, `peerId`. Peserta baru membuat offer ke semua peserta lama; ICE yang datang sebelum remote description ditampung dengan batas. Join lain yang valid otomatis meninggalkan kanal lama, disconnect/logout membersihkan roster. Bila kanal baru penuh, kanal lama tetap aktif. Jika jaringan putus, frontend menghentikan media dan meminta pengguna join ulang (tidak auto-join/membuka mikrofon tanpa tindakan baru).

### UI dan dependensi

- Kanal voice membuka izin mikrofon (audio saja), lalu layar voice lama jika join diterima. Mikrofon menonaktifkan track lokal dan memberi tanda ikon coret kepada peserta. Speaker hanya mengubah audio yang diterima secara lokal. Akhiri/kembali/berpindah layar membersihkan track, peer connection dan elemen audio. Roster kanal menampilkan maksimal tiga nama dan `+N`.
- QR di Feed/Sosial/Profil tetap membuka layar QR yang ada. Kode Saya menampilkan QR sendiri dan nama/tag, Salin dan Bagikan (fallback Salin). Pindai membuka kamera belakang; BarcodeDetector digunakan bila mendukung QR, jika tidak menggunakan jsQR lokal. Pergantian tab, keluar layar, logout dan scan berhasil menghentikan kamera. QR non-Koga ditolak. Pesan izin/HTTPS ditampilkan, bukan kegagalan diam-diam.
- Hanya dua dependensi langsung baru: `qrcode@1.5.4` dan `jsqr@1.4.0`. jsQR disalin saat instalasi ke `public/vendor/` (tanpa CDN). Artefak upstream belum tersedia di ZIP ini karena pembatasan DNS; build/install target menghasilkan file lokal yang wajib ada. Versi dan integrity dikunci, graph lockfile lama dipertahankan. Tidak ada framework UI atau WebRTC tambahan.
- HTML dan CSS `public/index.html` identik dengan tahap 2 kecuali satu tag script baru. Layar, kelas CSS dan layout yang ada digunakan; konten peserta/QR diisi secara runtime. Kamera voice, bagikan layar, aktivitas, undang dari voice dan chat shortcut tetap placeholder.

### Checklist manual media nyata (belum dijalankan oleh penyusun)

| Tes | Cara dan hasil yang diharapkan |
|---|---|
| Wi-Fi sama, STUN saja | Dua perangkat HTTPS, dua akun anggota server yang sama, join kanal voice. Bicara bergantian; kedua pihak mendengar. Coba mute/unmute, speaker, roster, leave dan join ulang. |
| Lima peserta | Lima akun/perangkat atau kombinasi browser bergabung; audio dan roster konsisten, peserta keenam ditolak. Periksa RAM/CPU STB dan browser, serta tidak ada audio ganda. |
| Satu Wi-Fi, satu data seluler tanpa TURN | Ulangi dengan TURN kosong; hasil dapat berhasil atau gagal tergantung NAT. Catat kandidat ICE dan status sambungan; kegagalan jaringan bukan lulus audio. |
| Satu Wi-Fi, satu data seluler dengan TURN | Aktifkan coturn, buka port, join ulang kedua akun. Pastikan audio dua arah dan periksa kandidat relay di `chrome://webrtc-internals`/statistik WebRTC serta log coturn. Gunakan jaringan yang memerlukan relay untuk membuktikan TURN benar dipakai. |
| Izin dan HTTPS | Tolak mikrofon/kamera; pesan penyebab dan perbaikan muncul. Uji HTTP non-localhost; aplikasi meminta HTTPS. Pastikan izin dapat diberikan ulang. |
| QR | Kode Saya, salin dan share. Pindai dari perangkat berbeda; uji BarcodeDetector dan browser tanpa dukungannya (jsQR). QR domain lain ditolak, permintaan muncul di akun tujuan dan tidak otomatis menjadi teman. Kamera berhenti saat tab/screen berubah. |
| Undangan tanpa login | Buka `/add/TAG` di browser logout, login/register, permintaan otomatis dikirim dan tab Permintaan terbuka. Ulangi link sendiri/duplikat/tag tak dikenal. |
| Regresi tahap 1/2 | Auth, admin, feed, permintaan teman, DM, server, kanal, chat realtime, reaksi, unread tetap berjalan pada STB. |

**Status serah terima tahap 3:** unit dan handler lokal serta simulasi antarmuka lulus; smoke HTTP/WS penuh, encoder/decoder QR asli, docker compose runtime, TURN dan pengujian media fisik belum terverifikasi karena dependensi tidak dapat diunduh dan akses browser localhost dibatasi. Jalankan `npm ci && npm run smoke` serta checklist sebelum deployment. Lihat `LAPORAN-TAHAP-3.md`.

Referensi teknis dependency dan TURN: https://www.npmjs.com/package/jsqr ; https://github.com/soldair/node-qrcode ; https://github.com/coturn/coturn/tree/master/docker/coturn .

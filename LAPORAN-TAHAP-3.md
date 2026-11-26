# Laporan serah terima Koga v3.0.0 — Tahap 3

## 1. Status dan ruang lingkup

Dasar pengerjaan: `Koga_Tahap_2.zip` yang tersedia pada percakapan ini. README, skema, REST API, WebSocket, frontend dan tes Tahap 2 dibaca sebelum perubahan. Pengguna menyatakan Tahap 1/2 lulus smoke pada lingkungan target; klaim tersebut belum diuji ulang dengan dependency produksi di lingkungan penyusunan ini.

Implementasi source Tahap 3 tersedia. Voice audio mesh, signaling pada `/ws`, RTC config, QR undangan, dan profile coturn ditambahkan. Tidak ada server aplikasi tambahan atau migrasi skema. Maksimal lima pengguna per kanal; satu koneksi voice per akun. Tahap berikutnya tidak dikerjakan.

**Status verifikasi: parsial, belum layak dinyatakan siap produksi.** Instalasi npm penuh gagal karena DNS registry tidak dapat diakses dan cache tidak memuat paket. Paket jsQR asli belum dapat dibundel sebagai byte file dalam ZIP; `npm ci`/Docker build menyalin versi 1.4.0 yang dipin ke `public/vendor/jsQR.js` dan lisensinya secara lokal. Browser tidak mengakses CDN. Smoke HTTP/WS penuh belum dapat dijalankan sampai dependency terpasang.

## 2. Berkas baru

| Berkas | Isi |
|---|---|
| `lib/voice.js` | State machine voice, akses anggota, kapasitas, signal, mute, roster, leave |
| `lib/rtc-config.js` | STUN/TURN, kredensial temporer HMAC-SHA1 |
| `lib/friend-request.js` | Logika permintaan teman bersama untuk REST dan link QR |
| `routes/voice-qr.js` | RTC config, URL/SVG QR akun, redirect undangan |
| `public/voice-qr.js` | WebRTC, audio, kontrol mute/speaker, QR dan lifecycle kamera |
| `scripts/vendor-qr.js` | Copy jsQR resmi dan lisensi dari npm ke folder statis |
| `public/vendor/README.txt` | Cara menyediakan decoder lokal, batas artefak ZIP |
| `test/voice-unit.js` | Empat kelompok unit test independen dari npm dependency |
| `test/voice-qr.js` | Smoke integrasi tujuh akun, voice dan QR tanpa media |
| `LAPORAN-TAHAP-3.md` | Laporan ini |

## 3. Berkas diubah

| Berkas | Perubahan |
|---|---|
| `lib/realtime.js` | Dispatch voice pada WS lama; lifecycle dan batas signal 60/detik |
| `routes/social.js` | Reuse friend-request dan tambahan users untuk kanal voice |
| `server.js` | Mount router baru sebelum fallback 404 API |
| `public/social.js` | Hook WS, sesi, navigasi, klik voice dan roster |
| `public/index.html` | Hanya satu baris `<script src="/voice-qr.js"></script>` |
| `test/smoke.js` | Tambahan environment dan eksekusi smoke Tahap 3, tes lama tetap |
| `test/social.js` | Ekspor helper socket/sleep, tes lama tetap |
| `package.json`, `package-lock.json` | v3.0.0, qrcode 1.5.4, jsqr 1.4.0, postinstall dan unit test |
| `Dockerfile` | Salin script dan hasil vendor lokal ke runtime |
| `docker-compose.yml` | Profile turn dengan coturn 4.19.1, host network, relay port dan kuota |
| `.env.example` | BASE_URL, STUN_URL, TURN_URL, TURN_SECRET, TURN_EXTERNAL_IP |
| `README.md` | Upgrade, konfigurasi, kontrak REST/WS dan checklist media |

Tidak ada file lama dihapus. `db.js`, `lib/social-schema.js`, `lib/social.js`, `routes/auth.js`, `routes/admin.js`, `routes/public.js`, `public/admin.html` tidak diubah. Semua entri dependency lama dalam lockfile identik. CSS, markup dan layout statis `public/index.html` identik byte-for-byte selain tambahan import script. Konten peserta, roster dan QR diisi saat runtime menggunakan komponen yang sudah ada.

## 4. Hasil tes aktual

| Skenario | Hasil aktual |
|---|---|
| `npm run test:voice` | 4/4 lulus, state machine dan ICE dengan dependency internal Node saja |
| Join anggota, non-anggota/kanal teks ditolak, peserta keenam ditolak | Lulus unit dan handler dengan transport WS simulasi + SQLite sungguhan (driver Node 22 pengganti sementara) |
| Signal hanya peserta kanal sama, data tidak valid/terlalu besar, rate 60/detik | Lulus unit/handler simulasi; frame WS nyata belum diuji |
| Putus WS, pindah kanal, satu koneksi/akun, logout, roster privat | Lulus unit/handler simulasi |
| TURN HMAC, expiry 1 jam, secret tidak bocor | Lulus unit/handler; TURN server belum dijalankan |
| QR redirect tanpa sesi, HEAD/subresource ditolak, permintaan/duplikat, tag asing | Lulus handler dengan SQLite sungguhan dan Express Router simulasi |
| SVG QR dan URL undangan | Lulus pengecekan argumen dan kontrak handler dengan encoder mock; qrcode asli belum diuji |
| Chromium offline | Lulus roster/join, offer/answer mock, mute/speaker, cleanup, pergantian tab QR, validasi origin QR dan POST permintaan. API, WebSocket, RTCPeerConnection, track dan detector disimulasikan; bukan uji audio/video nyata |
| Regresi Tahap 2 | Lulus uji lokal logika database (SQLite Node 22), permintaan, DM, server, kanal, reaction/read/unread, dan handler WS simulasi |
| Sintaks JS, perbandingan HTML/CSS, skema, lockfile, YAML | Lulus pemeriksaan statis |
| `npm ci --offline --ignore-scripts --dry-run --no-audit --no-fund` | Lulus pemeriksaan graph lockfile (151 paket direncanakan), tidak memasang paket |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | Gagal ENOTCACHED, dependency tidak tersedia |
| `npm run smoke` | Gagal saat bootstrap, `Cannot find module 'express'`; tidak ada skenario integrasi HTTP/WS nyata yang dieksekusi |
| Docker/coturn aktual | Belum dijalankan, hanya YAML diperiksa |

Catatan: percobaan browser localhost dengan perangkat media sintetis juga terblokir `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Tidak mengklaim peer WebRTC, kamera/mikrofon fisik atau encoder/decoder asli berhasil. Adapter sementara dan fixture simulasi tidak dimasukkan dalam kode produksi. Tidak ada data asli pengguna yang diubah selama pengerjaan.

## 5. Cara menjalankan

1. `docker compose stop`, backup `.env`, `data/`, `uploads/`, source Tahap 2. Ekstrak ZIP terpisah dan salin source baru saja; pertahankan konfigurasi/database/upload lama.
2. Tambahkan variabel baru dari `.env.example` ke `.env` lama. `BASE_URL` wajib berupa origin HTTPS yang dapat diakses pengguna untuk QR. Reverse proxy meneruskan upgrade WS dan skema HTTPS. HTTP IP LAN biasa tidak memenuhi syarat `getUserMedia`.
3. `npm ci && npm run test:voice && npm run smoke`. Pastikan decoder lokal `public/vendor/jsQR.js` muncul setelah instalasi dan smoke lulus. Jangan mengabaikan postinstall (jika harus, jalankan `node scripts/vendor-qr.js` sesudah npm ci).
4. Tanpa TURN: `docker compose up -d --build`; voice lintas NAT/CGNAT dapat gagal. Dengan TURN: isi `TURN_URL`, `TURN_SECRET` acak, `TURN_EXTERNAL_IP` jika diperlukan; `docker compose --profile turn up -d --build`. Cek `docker compose --profile turn logs -f coturn`. Port UDP/TCP 3478 dan UDP 49152–49200 harus dibuka/forward pada host TURN. Bila STB di balik CGNAT, VPS public IP bisa menjalankan profile coturn saja; Koga tetap di STB dan memakai TURN_URL/secret VPS.
5. Buka HTTPS Koga; jalankan checklist manual README. Rollback source Tahap 2 kompatibel dengan skema v2 yang tidak berubah, tetapi backup tetap dianjurkan.

## 6. Checklist tes manual media nyata

**Sudah dijalankan:** simulasi Chromium offline (bukan media nyata); pemeriksaan unit, handler dan sintaks seperti tabel di atas.

**Belum dijalankan:** dua perangkat fisik pada Wi-Fi sama dengan STUN saja; satu perangkat Wi-Fi dan satu seluler tanpa TURN; ulangi dengan TURN dan verifikasi kandidat relay; lima perangkat dan peserta keenam; izin mic/kamera asli ditolak/diterima ulang; kamera BarcodeDetector asli dan jsQR asli; scan QR antar perangkat; share native; link undangan melalui login browser nyata; Docker coturn/port forwarding; benchmark CPU/RAM STB; smoke produksi dan regresi lengkap. Langkah dan hasil yang diharapkan ada pada README.

## 7. Keputusan dan risiko

- Mesh 5 orang = maksimum 4 peer connection per browser; media tidak melewati Node. TURN menambah biaya bandwidth, relay port dan kuota total dapat habis jika banyak room. Kredensial username timestamp dapat sama dalam satu detik (sesuai permintaan); kuota per-user coturn tidak dipakai, hanya kuota total. TURN HMAC berlaku 1 jam; sesi panjang/reconnect dapat perlu join ulang, tidak ada ICE restart otomatis.
- Rate signal 60/detik per koneksi terpisah dari limit lama (30 event/detik, 5 chat/detik) untuk burst ICE tanpa mengubah throttle chat. Payload frame tetap maksimal 16 KiB. Roster hanya anggota server. Event tambahan `voice.left` mengakhiri media tab lama bila akun join dari tab/perangkat lain.
- Browser mengontrol izin perangkat, autoplay dan akses kamera/mikrofon. Jaringan yang memblokir TURN UDP/TCP 3478 mungkin membutuhkan TURN TLS/443 di konfigurasi lanjutan (tidak dikerjakan). Mode coturn host network untuk Linux; Docker image tag/arsitektur dan parameter harus diverifikasi pada STB target.
- GET `/add/:tag` sengaja mengirim permintaan otomatis sesuai spesifikasi, sehingga navigasi top-level lintas situs yang dipicu pihak lain dapat membuat permintaan jika pengguna sudah login. Prefetch/HEAD/subresource dengan header yang diketahui ditolak; penerima tetap perlu menerima secara eksplisit. Untuk kebijakan CSRF lebih ketat diperlukan konfirmasi pengguna + POST (perubahan perilaku di luar spesifikasi). QR scanner sendiri menggunakan POST sah. Unknown tag diperiksa setelah login agar tidak mempermudah enumerasi anonim. Link tidak memberikan akses ke server/DM.
- TURN secret hanya ada pada env/server/coturn, tidak dikirim sebagai plaintext ke browser; HMAC credential sementara memang dikirim sesuai protokol. Gunakan secret kuat, sinkronisasi jam dan HTTPS. P2P dapat mengekspos alamat IP kepada peserta melalui ICE; tidak ada mode relay-only wajib.
- Graph lockfile baru disusun menggunakan metadata versi/integrity yang tercantum pada lockfile publik dan lolos npm dry-run offline. Pemasangan nyata dan audit dependency belum dilakukan; jangan menyamakan dry-run dengan instalasi berhasil. Sumber metadata: `https://raw.githubusercontent.com/simonw/tools/main/package-lock.json`, `https://www.npmjs.com/package/jsqr` dan lockfile publik `leeguooooo/xhs-skill` untuk integrity jsqr. Tag coturn diverifikasi di dokumentasi resmi image: `https://github.com/coturn/coturn/tree/master/docker/coturn`.

## 8. Sengaja dilewati

Kamera/video chat, bagikan layar, aktivitas, SFU/LiveKit, rekaman, push, upload gambar chat, peran/izin lanjutan. Tombol kamera voice, screen share dan aktivitas tetap toast "Segera hadir". QR kamera hanya untuk scanner di layar QR. Tidak ada redesign, stylesheet baru atau tahap 4.

**Berhenti pada Tahap 3.** Paket kode telah disiapkan; sebelum produksi, wajib melakukan pemasangan npm, smoke penuh dan tes media nyata di target.

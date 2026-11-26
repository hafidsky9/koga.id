# Laporan serah terima Koga — Tahap 2

Status: implementasi kode tersedia; smoke test integrasi penuh belum terverifikasi.

## Berkas

| Berkas | Perubahan |
|---|---|
| `db.js`, `lib/social-schema.js` | Migrasi v2 transaksional, tag dan status, tabel/index sosial, DM, server, kanal, pesan, reaksi, reads |
| `lib/social.js` | Validasi, otorisasi, template seed, pesan/reply/mention/reaksi/read, pagination |
| `routes/social.js` | REST sosial, DM, server, template, kanal, status |
| `lib/realtime.js` | WebSocket cookie sesi, Origin, presence, broadcast, heartbeat, batas rate/payload |
| `server.js`, `lib/store.js` | Sambungan WS ke server/sesi yang sudah ada dan cabut koneksi saat sesi dihapus |
| `routes/auth.js`, `lib/http.js` | Tag untuk akun baru/admin; tambahan data profil |
| `public/index.html` | Hanya perubahan JavaScript, pemuatan modul sosial; blok CSS dan markup sebelum script identik |
| `public/social.js` | Isi data nyata dan handler sosial/komunitas menggunakan komponen UI lama |
| `package.json`, `package-lock.json` | Versi aplikasi 2.0.0, hanya tambahan dependency `ws` 8.21.3 |
| `test/smoke.js`, `test/social.js`, `test/migration.js` | Pertahankan skenario Tahap 1, perluas tes Tahap 2 dua pengguna dan admin sebagai pihak luar; tes migrasi |
| `README.md`, `LAPORAN-TAHAP-2.md` | Petunjuk upgrade, API, WS, penggunaan dan batas verifikasi |

`public/admin.html`, `routes/admin.js`, `routes/public.js`, `lib/upload.js`, `Dockerfile`, `docker-compose.yml`, `.env.example` tidak diubah. Data produksi dan file upload tidak disertakan atau ditimpa.

## Cara menjalankan

Ikuti README, terutama bagian upgrade. Backup `.env`, `data/`, `uploads/` setelah menghentikan kontainer.
Di mesin dengan Node 20+ serta akses npm, jalankan `npm ci` kemudian `npm run smoke`.
Untuk STB: `docker compose up -d --build`.

## Hasil verifikasi

- **Lulus**: parsing `node --check` seluruh file JavaScript, termasuk skrip inline halaman utama.
- **Lulus**: perbandingan byte markup HTML sebelum blok skrip, blok CSS, dan `admin.html` terhadap ZIP asli.
- **Lulus (verifikasi tambahan, bukan smoke penuh)**: migrasi v1 → v2 pada SQLite sungguhan lewat driver pengganti sementara Node 22 `node:sqlite`: akun, hash password, role, konten, sesi, tag tetap setelah restart, WAL dan foreign keys. Driver pengganti hanya untuk verifikasi lokal, tidak disertakan dan bukan dependency produksi.
- **Lulus (verifikasi tambahan)**: handler REST langsung dengan SQLite sungguhan, tanpa Express/WS jaringan: tag unik, permintaan/duplikasi/accept IDOR, DM antar teman, mention, histori, reaksi, pembuatan/join server, owner/anggota, reply/read IDOR, unread, cursor, validasi pesan, integritas FK.
- **Terblokir**: `npm ci` tidak dapat menjangkau `registry.npmjs.org` (DNS); `npm ci --offline` menghasilkan `ENOTCACHED`. Akibatnya `npm run smoke` tidak dapat memulai Express (`MODULE_NOT_FOUND`), bukan hasil pass/fail fungsional. Pengujian HTTP/WS nyata tetap harus dijalankan pada mesin target. Tidak ada klaim regresi tahap 1 lulus ulang.
- **Lulus (verifikasi tambahan, bukan jaringan nyata)**: handler WS dengan transport simulasi dan SQLite sungguhan: penolakan Origin/sesi, presence privat, distribusi DM dan kanal, non-anggota ditolak, pesan terlalu panjang, rate 5/detik, logout, konfigurasi payload 16 KiB.
- **Lulus (browser offline dengan fixture API/WS)**: Chromium memeriksa profil/tag, pencarian, perpindahan tab, keadaan kosong, permintaan teman, DM/ack, badge, escaping XSS, mention, reply/reaksi/read, wizard server, voice statis, dan status. Tidak ada `pageerror` pada skenario tersebut.
- **Terblokir**: upaya browser Chromium pada HTTP loopback ditolak kebijakan administrator (`ERR_BLOCKED_BY_ADMINISTRATOR`). Uji offline menggunakan HTML dan JavaScript yang sama, tetapi bukan server asli dan tidak menguji CSP jaringan aktual.

## Yang sengaja dilewati

Voice realtime, QR nyata, upload gambar chat, peran/izin lanjutan, push, rotasi/revoke undangan, dan perubahan desain/CSS. Voice dan QR tetap statis sebagaimana Tahap 1. Tidak ada data sosial/pesan contoh yang dimasukkan ke DB produksi.

## Risiko dan keputusan

1. Wajib menjalankan smoke lengkap sebelum upgrade produksi. Migrasi sudah diuji pada data fixture, bukan DB STB aktual; backup tetap wajib. DB v2 tidak kompatibel dengan jalur insert user kode tahap 1.
2. Gunakan HTTPS/WSS untuk internet, konfigurasikan proxy upgrade dan Origin. Uji pada STB, termasuk browser yang mungkin memiliki perilaku CSP/WebSocket berbeda. Audit npm dan pemakaian RAM pada beban riil belum dilakukan.
3. Presence per proses hilang saat restart; logout menutup socket dan validasi sesi dilakukan pada setiap event. Pekerjaan realtime tidak dirancang untuk beberapa worker.
4. Pagination memakai offset untuk daftar dan cursor untuk pesan. SQL memakai statement parameterized dan indeks; belum ada benchmark dataset besar. Filter klien hanya menjangkau halaman yang sudah dimuat. Unread pada server lama dapat meningkat untuk anggota baru; histori lama sengaja dapat dibaca anggota.
5. Kode undangan bisa disalin seluruh anggota; belum ada rotasi, revoke, atau pembatasan undangan per akun. Endpoint tambah teman juga belum memiliki pembatasan khusus enumerasi tag. Rate pesan WS sesuai spesifikasi per koneksi, bukan per akun.
6. Jika koneksi terputus setelah pesan tersimpan tetapi sebelum ack, mengirim ulang manual bisa menyebabkan duplikasi. Tidak ada outbox/retry otomatis. Histori DM disimpan setelah hapus teman, tetapi akses diblokir sampai berteman kembali.
7. Input status/ID/join dan kategori kanal memakai dialog browser untuk mempertahankan layout. CSS/markup sumber tetap identik, namun konten dinamis mengganti placeholder dengan data nyata dan memakai kelas lama untuk kontrol baru. Invite code dibangkitkan acak; tab voice tidak memulai koneksi audio.
8. Lockfile `ws` dirakit dari metadata versi yang tersedia karena registry tidak dapat diakses langsung saat pengerjaan. Jalankan `npm ci` untuk memverifikasi integritas tarball di lingkungan target. Rujukan metadata: https://github.com/ProtonMail/jsmimeparser/blob/main/package-lock.json; versi menghindari versi yang terkena advisory GHSA-96hv-2xvq-fx4p (https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p).

Berhenti pada Tahap 2. Tahap 3 tidak dikerjakan.

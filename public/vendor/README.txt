jsQR 1.4.0 (Apache-2.0) dipasang dari npm yang integrity-nya terkunci di package-lock.json.
`npm ci` menjalankan scripts/vendor-qr.js, menyalin dist/jsQR.js dan LICENSE ke folder ini.
Docker menyalin berkas hasil build dari sini ke image runtime. Tidak ada CDN di browser.
Berkas upstream belum dapat diambil di lingkungan penyusunan ini (DNS npm terblokir).

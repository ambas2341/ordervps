///===========ANTI-CRASH HANDLER (WAJIB ADA)=======\\\\\
// 1. Menangkap error polling (koneksi putus nyambung)
bot.on('polling_error', (error) => {
    console.log('⚠️ Polling Error:', error.message);
});

// 2. Menangkap error "Bad Request" atau error coding lainnya agar bot GAK MATI
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    // Bot tetap jalan, hanya lapor error di console
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    // Bot tetap jalan
});
///===========CONST & DEPENDENCIES=======\\\\\
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs'); // TAMBAHAN: Module File System
const config = require('./config.js');

// Inisialisasi Bot
const bot = new TelegramBot(config.token, { polling: true });

///===========DATABASE DINAMIS (FILE JSON)=======\\\\\
// Ini untuk menyimpan API Key agar kalau bot restart, key barunya tetep kesimpen
const dbFile = './database.json';
let dynamicDb = {
    apiDigitalOcean: config.apiDigitalOcean // Default ambil dari config.js
};

// Cek apakah file database.json ada, kalau ada load, kalau tidak buat baru
if (fs.existsSync(dbFile)) {
    try {
        const loadDb = JSON.parse(fs.readFileSync(dbFile));
        dynamicDb = loadDb;
    } catch (e) {
        console.error("Gagal load database, menggunakan default config.");
    }
} else {
    fs.writeFileSync(dbFile, JSON.stringify(dynamicDb, null, 2));
}

// Fungsi Simpan Database
function saveDatabase() {
    fs.writeFileSync(dbFile, JSON.stringify(dynamicDb, null, 2));
}

///===========DATABASE SEMENTARA (MEMORY)=======\\\\\
const dbpembayaran = {};

///===========HELPER FUNCTIONS=======\\\\\
function getRuntime() {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    return `${hours} Jam ${minutes} Menit ${seconds} Detik`;
}

function formatRupiah(angka) {
    return "Rp " + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

///===========START COMMAND=======\\\\\
bot.onText(/\/start/, async (msg) => {
    const user = msg.from;
    const caption = `🤖 <b>DigitalOcean VPS Bot</b>

Halo <b>${user.first_name}</b>!
Selamat datang di bot otomatisasi pembelian VPS DigitalOcean.

⏱ <b>Runtime:</b> ${getRuntime()}
💻 <b>Status Server:</b> Online

Gunakan perintah /buyvps untuk membeli VPS secara otomatis.`;

    const opts = {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🛒 Beli VPS Sekarang", callback_data: "menu_buyvps" }],
                [{ text: "👨‍💻 Hubungi Admin", url: config.urlown }]
            ]
        }
    };

    try {
        await bot.sendPhoto(msg.chat.id, './Z$/header.jpg', { caption, ...opts }); 
    } catch (e) {
        await bot.sendMessage(msg.chat.id, caption, opts);
    }
});

///===========FITUR UPDATE API KEY (NEW)=======\\\\\
bot.onText(/\/up (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newApiKey = match[1].trim(); // Ambil text setelah /up

    // Security Check: Hanya Owner yang boleh
    if (userId !== config.ownerid) {
        return bot.sendMessage(chatId, "❌ <b>Akses Ditolak!</b> Anda bukan Owner.", {parse_mode:"HTML"});
    }

    if (!newApiKey) {
        return bot.sendMessage(chatId, "⚠️ Format salah. Gunakan: <code>/up do_v1_xxxx</code>", {parse_mode:"HTML"});
    }

    // Update variable memory
    dynamicDb.apiDigitalOcean = newApiKey;
    
    // Simpan ke file agar permanen
    saveDatabase();

    await bot.sendMessage(chatId, `✅ <b>API DigitalOcean Berhasil Diupdate!</b>\n\nKey baru tersimpan dan langsung aktif.\nAkhiran Key: <code>...${newApiKey.slice(-10)}</code>`, {parse_mode:"HTML"});
});

// Cek API Key & Saldo (Command Baru untuk Test)
bot.onText(/\/api/, async (msg) => {
    if (msg.from.id !== config.ownerid) return;
    const currentKey = dynamicDb.apiDigitalOcean;

    const loading = await bot.sendMessage(msg.chat.id, "🔄 Mencoba koneksi ke DigitalOcean...");

    try {
        const res = await axios.get("https://api.digitalocean.com/v2/account", {
            headers: { Authorization: `Bearer ${currentKey}` }
        });
        
        const status = res.data.account.status;
        const limit = res.data.account.droplet_limit;
        
        await bot.editMessageText(`✅ <b>API KEY VALID!</b>\n\nStatus Akun: ${status}\nDroplet Limit: ${limit}\n\nKey Sedang Dipakai:\n<code>${currentKey}</code>`, {
            chat_id: msg.chat.id,
            message_id: loading.message_id,
            parse_mode: "HTML"
        });
    } catch (e) {
        const errorMsg = e.response ? `${e.response.status} ${e.response.statusText}` : e.message;
        await bot.editMessageText(`❌ <b>API KEY INVALID!</b>\n\nError dari DO: <b>${errorMsg}</b>\n\nPastikan key yang diinput benar dan akun tidak di-banned.`, {
            chat_id: msg.chat.id,
            message_id: loading.message_id,
            parse_mode: "HTML"
        });
    }
});

// Cek API Key saat ini (Optional, buat ngecek aja)
bot.onText(/\/cekapi/, async (msg) => {
    if (msg.from.id !== config.ownerid) return;
    const currentKey = dynamicDb.apiDigitalOcean;
    bot.sendMessage(msg.chat.id, `🔑 <b>API Key Saat Ini:</b>\n<code>${currentKey}</code>`, {parse_mode:"HTML"});
});


///===========LOGIC HANDLER UTAMA=======\\\\\

// Command Trigger Buy
bot.onText(/\/buyvps/, (msg) => sendVpsMenu(msg.chat.id));

// Handler Callback Query (Pusat Logika)
bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const msgId = callbackQuery.message.message_id;

    try {
        // 1. Menu Utama VPS
        if (data === "menu_buyvps") {
            await bot.deleteMessage(chatId, msgId).catch(() => {});
            return sendVpsMenu(chatId);
        }

        // 2. Cancel Action
        if (data === "cancel") {
            if (dbpembayaran[userId]) {
                clearInterval(dbpembayaran[userId].interval);
                delete dbpembayaran[userId];
            }
            await bot.deleteMessage(chatId, msgId).catch(() => {});
            return bot.sendMessage(chatId, "❌ Transaksi dibatalkan.");
        }
        
        // ==========================================
        // LOGIC KHUSUS OWNER (BYPASS BAYAR / CREATE)
        // ==========================================
        if (data.startsWith("adm_create_")) {
            if (userId !== config.ownerid) return;

            const slug = data.replace("adm_create_", "");

            dbpembayaran[userId] = {
                reff: `OWNER-${Date.now()}`, 
                msgId: msgId,
                amount: 0, 
                vpsData: { size: slug },
                isPaid: true, 
                username: callbackQuery.from.username
            };

            await bot.deleteMessage(chatId, msgId).catch(() => {});
            await bot.sendMessage(chatId, "✅ <b>Akses Owner Dikonfirmasi.</b>\nMelanjutkan ke pemilihan Region...", {parse_mode:"HTML"});

            return askRegion(chatId);
        }

        // ==========================================
        // LOGIC KHUSUS OWNER (DELETE VPS)
        // ==========================================
        
        // Tahap 1: Konfirmasi Hapus
        if (data.startsWith("ask_del_")) {
            if (userId !== config.ownerid) return;
            const idDroplet = data.replace("ask_del_", "");
            
            try {
                // UPDATE: Menggunakan dynamicDb.apiDigitalOcean
                const res = await axios.get(`https://api.digitalocean.com/v2/droplets/${idDroplet}`, {
                    headers: { Authorization: `Bearer ${dynamicDb.apiDigitalOcean}` }
                });
                const d = res.data.droplet;
                const ip = d.networks.v4.find(n => n.type === 'public')?.ip_address || "-";

                await bot.editMessageText(`⚠️ <b>KONFIRMASI PENGHAPUSAN!</b>\n\nVPS: <b>${d.name}</b>\nIP: <code>${ip}</code>\nStatus: ${d.status}\n\nApakah Anda yakin ingin MENGHANCURKAN server ini? Data tidak bisa kembali!`, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ YA, HAPUS PERMANEN!", callback_data: `fix_del_${idDroplet}` }],
                            [{ text: "❌ JANGAN, KEMBALI", callback_data: "cancel" }]
                        ]
                    }
                });
            } catch (e) {
                 await bot.editMessageText(`⚠️ <b>KONFIRMASI HAPUS</b>\n\nYakin hapus VPS ID ${idDroplet}?`, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ YA HAPUS", callback_data: `fix_del_${idDroplet}` }],
                            [{ text: "❌ BATAL", callback_data: "cancel" }]
                        ]
                    }
                });
            }
        }

        // Tahap 2: Eksekusi Hapus
        if (data.startsWith("fix_del_")) {
            if (userId !== config.ownerid) return;
            const idDroplet = data.replace("fix_del_", "");
            
            await bot.deleteMessage(chatId, msgId).catch(()=>{});
            const loadingMsg = await bot.sendMessage(chatId, `💣 <b>Sedang meledakkan VPS...</b>`, {parse_mode:"HTML"});

            try {
                // UPDATE: Menggunakan dynamicDb.apiDigitalOcean
                await axios.delete(`https://api.digitalocean.com/v2/droplets/${idDroplet}`, {
                    headers: { Authorization: `Bearer ${dynamicDb.apiDigitalOcean}` }
                });
                await bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                await bot.sendMessage(chatId, `✅ <b>SUKSES!</b>\nVPS telah berhasil dihapus dari akun DigitalOcean.`, {parse_mode:"HTML"});
            } catch (error) {
                console.error("Delete Error:", error.message);
                bot.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                bot.sendMessage(chatId, "❌ Gagal menghapus. Mungkin VPS sudah tidak ada atau API Key salah.");
            }
        }

        // ==========================================
        // LOGIC USER BUY VPS (REGULER)
        // ==========================================

        // 3. Pilih Paket VPS -> Proses Pembayaran
        if (data.startsWith("buyvps_")) {
            if (dbpembayaran[userId]) {
                return bot.sendMessage(chatId, "⚠️ Anda memiliki transaksi yang belum selesai. Ketik /start untuk mereset.");
            }

            const choice = data.split("_")[1];
            // Daftar Harga & Spek
            const vpsOptions = {
                1: { name: "1 vCPU / 2GB RAM", slug: "s-1vcpu-2gb", price: 20000 },
                2: { name: "2 vCPU / 2GB RAM", slug: "s-2vcpu-2gb", price: 25000 },
                3: { name: "2 vCPU / 4GB RAM", slug: "s-2vcpu-4gb", price: 30000 },
                4: { name: "4 vCPU / 8GB RAM", slug: "s-4vcpu-8gb", price: 40000 },
                5: { name: "4 vCPU / 16GB RAM", slug: "s-4vcpu-16gb-amd", price: 50000 },
                6: { name: "8 vCPU / 16GB RAM", slug: "s-8vcpu-16gb-amd", price: 75000 },
                7: { name: "8 vCPU / 32GB RAM", slug: "s-8vcpu-32gb-amd", price: 120000 }
            };

            const selected = vpsOptions[choice];
            if (!selected) return;

            await bot.deleteMessage(chatId, msgId).catch(() => {});
            
            // === GANTI JADI PAKASIR ===
            await processPaymentPakasir(chatId, userId, callbackQuery.from, selected);
        }

        // 4. Pilih Region
        if (data.startsWith("region_")) {
            if (!dbpembayaran[userId] || !dbpembayaran[userId].isPaid) {
                return bot.sendMessage(chatId, "⚠️ Sesi tidak valid atau belum dibayar.");
            }
            const region = data.split("_")[1];
            dbpembayaran[userId].vpsData.region = region;
            
            await bot.deleteMessage(chatId, msgId).catch(() => {});
            return askOS(chatId);
        }

        // 5. Pilih OS -> Create Droplet
        if (data.startsWith("os_")) {
            if (!dbpembayaran[userId] || !dbpembayaran[userId].isPaid) return;
            const osSlug = data.replace("os_", ""); 
            dbpembayaran[userId].vpsData.image = osSlug;

            await bot.deleteMessage(chatId, msgId).catch(() => {});
            return createDroplet(chatId, userId);
        }

    } catch (error) {
        console.error("Callback Error:", error);
        bot.sendMessage(chatId, "❌ Terjadi kesalahan pada sistem.");
    }
});

///===========FUNCTION: MENU VPS=======\\\\\
async function sendVpsMenu(chatId) {
    const vpsOptions = [
        [
            { text: "💻 1 vCPU 2GB - Rp 20.000", callback_data: "buyvps_1" },
        ],
        [
            { text: "💻 2 vCPU 2GB - Rp 25.000", callback_data: "buyvps_2" },
        ],
        [
            { text: "💻 2 vCPU 4GB - Rp 30.000", callback_data: "buyvps_3" },
        ],
        [
            { text: "💻 4 vCPU 8GB - Rp 40.000", callback_data: "buyvps_4" },
        ],
        [
            { text: "💻 4 vCPU 16GB - Rp 50.000", callback_data: "buyvps_5" },
        ],
        [
            { text: "❌ 8 vCPU 16GB - Rp 75.000", callback_data: "buyvps_6" },
        ],
        [
            { text: "❌ 8 vCPU 32GB - Rp 120.000", callback_data: "buyvps_7" }
        ],
        [
            { text: "❌ Batal", callback_data: "cancel" }
        ]
    ];

    const caption = `🖥️ <b>MENU PEMBELIAN VPS PREMIUM</b>
    
Silakan pilih spesifikasi VPS yang Anda inginkan.
Semua VPS menggunakan server DigitalOcean dengan garansi full 30 hari.`;

    await bot.sendMessage(chatId, caption, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: vpsOptions }
    });
}

// ==================================================
// FITUR KHUSUS OWNER: CREATE VPS (GRATIS)
// ==================================================
bot.onText(/\/create/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.from.id !== config.ownerid) {
        return bot.sendMessage(chatId, "❌ Maaf, perintah ini khusus Owner Bot.");
    }

    const adminVpsMenu = [
        [ { text: "👑 1 vCPU / 2GB", callback_data: "adm_create_s-1vcpu-2gb" } ],
        [ { text: "👑 2 vCPU / 2GB", callback_data: "adm_create_s-2vcpu-2gb" } ],
        [ { text: "👑 2 vCPU / 4GB", callback_data: "adm_create_s-2vcpu-4gb" } ],
        [ { text: "👑 4 vCPU / 8GB", callback_data: "adm_create_s-4vcpu-8gb" } ],
        [ { text: "👑 4 vCPU / 16GB", callback_data: "adm_create_s-4vcpu-16gb-amd" } ],
        [ { text: "❌ 8 vCPU / 16GB", callback_data: "adm_create_s-8vcpu-16gb-amd" } ],
        [ { text: "❌ Batal", callback_data: "cancel" } ]
    ];

    await bot.sendMessage(chatId, "👑 <b>MODE OWNER ACTIVATED</b>\n\nSilakan pilih paket VPS yang ingin dibuat (Bypass Payment):", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: adminVpsMenu }
    });
});

// ==================================================
// FITUR KHUSUS OWNER: DELETE VPS (LIST & CLICK)
// ==================================================
bot.onText(/\/deletevps/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.from.id !== config.ownerid) return bot.sendMessage(chatId, "❌ Fitur khusus Owner.");

    const loading = await bot.sendMessage(chatId, "🔄 <b>Mengambil data VPS...</b>", {parse_mode: "HTML"});

    try {
        // UPDATE: Menggunakan dynamicDb.apiDigitalOcean
        const response = await axios.get("https://api.digitalocean.com/v2/droplets?per_page=100", {
            headers: { Authorization: `Bearer ${dynamicDb.apiDigitalOcean}` }
        });
        const droplets = response.data.droplets;

        if (droplets.length === 0) {
            await bot.deleteMessage(chatId, loading.message_id);
            return bot.sendMessage(chatId, "✅ <b>Tidak ada VPS yang aktif.</b>", {parse_mode: "HTML"});
        }

        const keyboard = droplets.map(d => {
            const ip = d.networks.v4.find(n => n.type === 'public')?.ip_address || "No IP";
            const statusIcon = d.status === 'active' ? '🟢' : '🔴';
            return [{ 
                text: `🗑 ${statusIcon} ${d.name} (${ip})`, 
                callback_data: `ask_del_${d.id}` 
            }];
        });
        keyboard.push([{ text: "❌ Batalkan & Tutup", callback_data: "cancel" }]);

        await bot.deleteMessage(chatId, loading.message_id);
        await bot.sendMessage(chatId, `⚠️ <b>MENU PENGHAPUSAN VPS</b>\n\nTotal VPS Aktif: <b>${droplets.length}</b>\nTekan tombol di bawah untuk menghapus VPS permanen:`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: keyboard }
        });

    } catch (error) {
        console.error("List Droplet Error:", error.message);
        bot.deleteMessage(chatId, loading.message_id).catch(()=>{});
        bot.sendMessage(chatId, "❌ Gagal mengambil data dari DigitalOcean. Cek API Key.");
    }
});

///===========FUNCTION: PAYMENT PAKASIR (PENGGANTI DUITKU)=======\\\\\
async function processPaymentPakasir(chatId, userId, userProfile, product) {
    const loading = await bot.sendMessage(chatId, "⏳ Sedang membuat tagihan QRIS Pakasir...");
    
    const reff = `VPS-${Date.now()}-${userId}`;
    const amount = product.price;

    let paymentResp;
    try {
        // Request Inquiry ke PAKASIR
        paymentResp = await axios.post("https://app.pakasir.com/api/transactioncreate/qris", {
            project: config.pakasirProject, 
            order_id: reff,
            amount: amount,
            customer_name: userProfile.first_name || "User VPS",
            customer_email: `${userId}@telegram.bot`,
            customer_phone: "081234567890",
            api_key: config.pakasirApiKey 
        }, {
            headers: { "Content-Type": "application/json" }
        });

    } catch (e) {
        console.error("Pakasir Error:", e.response?.data || e.message);
        await bot.deleteMessage(chatId, loading.message_id).catch(()=>{});
        return bot.sendMessage(chatId, "❌ Gagal membuat invoice Pakasir. Cek Config/API Key.");
    }

    const result = paymentResp.data;

    if (!result?.payment?.payment_number) {
        await bot.deleteMessage(chatId, loading.message_id).catch(()=>{});
        return bot.sendMessage(chatId, "❌ Gagal generate QRIS. Respons API tidak valid.");
    }

    const qrString = result.payment.payment_number;
    const totalBayar = result.payment.total_payment || amount;

    // Generate QR Image
    const buffer = await QRCode.toBuffer(qrString, { width: 400, margin: 2, color: { dark: "#000000", light: "#ffffff" } });
    await bot.deleteMessage(chatId, loading.message_id).catch(()=>{});

    const msgQr = await bot.sendPhoto(chatId, buffer, {
        caption: `🧾 <b>INVOICE PEMBAYARAN</b>

📦 <b>Item:</b> ${product.name}
💰 <b>Total:</b> ${formatRupiah(totalBayar)}
🆔 <b>Order ID:</b> <code>${reff}</code>
⏳ <b>Expired:</b> 5 Menit

<i>Silakan scan QRIS di atas. Sistem cek otomatis setiap 15 detik.</i>`,
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "❌ Batalkan", callback_data: "cancel" }]
            ]
        }
    });

    // Simpan status sementara
    dbpembayaran[userId] = {
        reff: reff,
        msgId: msgQr.message_id,
        amount: totalBayar,
        vpsData: { size: product.slug },
        isPaid: false,
        username: userProfile.username
    };

    // Polling Status Pembayaran (Setiap 15 Detik)
    let attempts = 0;
    dbpembayaran[userId].interval = setInterval(async () => {
        attempts++;
        
        if (attempts > 20 || !dbpembayaran[userId]) {
            if (dbpembayaran[userId]) {
                clearInterval(dbpembayaran[userId].interval);
                bot.deleteMessage(chatId, dbpembayaran[userId].msgId).catch(()=>{});
                bot.sendMessage(chatId, "❌ Waktu pembayaran habis (Timeout).");
                delete dbpembayaran[userId];
            }
            return;
        }

        try {
            // Cek API Pakasir
            const statusUrl = `https://app.pakasir.com/api/transactiondetail?project=${config.pakasirProject}&amount=${amount}&order_id=${reff}&api_key=${config.pakasirApiKey}`;
            const res = await axios.get(statusUrl);
            const status = res.data?.transaction?.status; // 'pending' atau 'completed'

            if (status === "completed") {
                // === PEMBAYARAN SUKSES ===
                clearInterval(dbpembayaran[userId].interval);
                dbpembayaran[userId].isPaid = true;
                
                await bot.deleteMessage(chatId, dbpembayaran[userId].msgId).catch(()=>{});
                await bot.sendMessage(chatId, "✅ <b>Pembayaran Diterima!</b>\nMelanjutkan ke konfigurasi VPS...", {parse_mode: "HTML"});

                // Notifikasi Owner
                const notifText = `💰 <b>UANG MASUK (Terima Kasih)!</b>

👤 <b>Buyer:</b> @${dbpembayaran[userId].username || "Tanpa Username"}
💵 <b>Nominal:</b> ${formatRupiah(dbpembayaran[userId].amount)}
🆔 <b>Ref:</b> <code>${reff}</code>

<i>User sedang memilih Region & OS...</i>`;
                
                await bot.sendMessage(config.ownerid, notifText, {parse_mode: "HTML"}).catch(()=>{});

                askRegion(chatId);

            }
        } catch (err) {
            // silent error
        }
    }, 15000); 
}

///===========FUNCTION: KONFIGURASI VPS=======\\\\\
async function askRegion(chatId) {
    const regions = [
        [
            { text: "🇺🇸 New York 1 (nyc1)", callback_data: "region_nyc1" },
            { text: "🇺🇸 San Francisco 1 (sfo1)", callback_data: "region_sfo1" }
        ],
        [
            { text: "🇺🇸 New York 2 (nyc2)", callback_data: "region_nyc2" },
            { text: "🇳🇱 Amsterdam 2 (ams2)", callback_data: "region_ams2" }
        ],
        [
            { text: "🇸🇬 Singapore 1 (sgp1)", callback_data: "region_sgp1" },
            { text: "🇬🇧 London 1 (lon1)", callback_data: "region_lon1" }
        ],
        [
            { text: "🇺🇸 New York 3 (nyc3)", callback_data: "region_nyc3" },
            { text: "🇳🇱 Amsterdam 3 (ams3)", callback_data: "region_ams3" }
        ],
        [
            { text: "🇩🇪 Frankfurt 1 (fra1)", callback_data: "region_fra1" },
            { text: "🇨🇦 Toronto 1 (tor1)", callback_data: "region_tor1" }
        ],
        [
            { text: "🇺🇸 San Francisco 2 (sfo2)", callback_data: "region_sfo2" },
            { text: "🇮🇳 Bangalore 1 (blr1)", callback_data: "region_blr1" }
        ],
        [
            { text: "🇺🇸 San Francisco 3 (sfo3)", callback_data: "region_sfo3" },
            { text: "🇦🇺 Sydney 1 (syd1)", callback_data: "region_syd1" }
        ],
        [
             { text: "🇺🇸 Atlanta 1 (atl1)", callback_data: "region_atl1" }
        ]
    ];

    await bot.sendMessage(chatId, "🌍 <b>Pilih Lokasi Server (Region):</b>", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: regions }
    });
}

async function askOS(chatId) {
    const osList = [
        [
            { text: "Rocky Linux 9", callback_data: "os_rockylinux-9-x64" },
            { text: "Rocky Linux 8", callback_data: "os_rockylinux-8-x64" }
        ],
        [
            { text: "Ubuntu 22.04", callback_data: "os_ubuntu-22-04-x64" },
            { text: "Fedora 41", callback_data: "os_fedora-41-x64" }
        ],
        [
            { text: "Ubuntu 25.04", callback_data: "os_ubuntu-25-04-x64" },
            { text: "Ubuntu 24.04", callback_data: "os_ubuntu-24-04-x64" }
        ],
        [
            { text: "AlmaLinux 10", callback_data: "os_almalinux-10-x64" },
            { text: "CentOS Stream 9", callback_data: "os_centos-stream-9-x64" }
        ],
        [
            { text: "Rocky Linux 10", callback_data: "os_rockylinux-10-x64" },
            { text: "Fedora 42", callback_data: "os_fedora-42-x64" }
        ]
    ];

    await bot.sendMessage(chatId, "💿 <b>Pilih Sistem Operasi (OS):</b>", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: osList }
    });
}

///===========FUNCTION: CREATE VPS DI DIGITALOCEAN=======\\\\\
async function createDroplet(chatId, userId) {
    const data = dbpembayaran[userId];
    const hostname = `VPS-${data.username || userId}-${Date.now()}`;
    const password = config.passwordvps;

    await bot.sendMessage(chatId, `⚙️ <b>Sedang Membuat VPS...</b>\n\nHost: ${hostname}\nRegion: ${data.vpsData.region}\nOS: ${data.vpsData.image}\n\n<i>Mohon tunggu sekitar 60 detik...</i>`, {parse_mode:"HTML"});

    try {
        // UPDATE: Menggunakan dynamicDb.apiDigitalOcean
        const createRes = await axios.post(
            "https://api.digitalocean.com/v2/droplets",
            {
                name: hostname,
                region: data.vpsData.region,
                size: data.vpsData.size,
                image: data.vpsData.image,
                ipv6: true,
                user_data: `#cloud-config\npassword: ${password}\nchpasswd: { expire: False }`
            },
            {
                headers: { Authorization: `Bearer ${dynamicDb.apiDigitalOcean}` }
            }
        );

        const dropletId = createRes.data.droplet.id;
        await new Promise(r => setTimeout(r, 60000));

        const detailRes = await axios.get(
            `https://api.digitalocean.com/v2/droplets/${dropletId}`,
            { headers: { Authorization: `Bearer ${dynamicDb.apiDigitalOcean}` } }
        );

        const ip = detailRes.data.droplet.networks.v4.find(n => n.type === 'public').ip_address;

        const resultText = `✅ <b>VPS BERHASIL DIBUAT!</b>

🌐 <b>IP Address:</b> <code>${ip}</code>
👤 <b>Username:</b> <code>root</code>
🔑 <b>Password:</b> <code>${password}</code>
🖥 <b>OS:</b> ${data.vpsData.image}
🌍 <b>Region:</b> ${data.vpsData.region}

<i>Harap segera ganti password setelah login demi keamanan.</i>`;

        await bot.sendMessage(chatId, resultText, { parse_mode: "HTML" });
        
        // Kirim Notif ke Owner/Channel (Laporan Final)
        const logText = `🛒 <b>PEMBELIAN VPS SUKSES (FINAL)</b>\nUser: @${data.username}\nIP: ${ip}\nOS: ${data.vpsData.image}\nPrice: ${formatRupiah(data.amount)}`;
        await bot.sendMessage(config.channelid, logText, { parse_mode: "HTML" }).catch(()=>{});

        delete dbpembayaran[userId];

    } catch (error) {
        console.error("Create Droplet Error:", error.response ? error.response.data : error.message);
        bot.sendMessage(chatId, "❌ Gagal membuat Droplet di DigitalOcean. Silakan hubungi admin (API Key Error?).");
    }
}

console.log("Bot sedang berjalan...");

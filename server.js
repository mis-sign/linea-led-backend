require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY || ADMIN_API_KEY === 'change-this-to-a-long-random-string') {
    console.warn('\n⚠️  WARNING: ADMIN_API_KEY is not set to a secure value in .env — admin routes are NOT protected properly.\n');
}

app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Too many submissions from this device. Please try again later.' }
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
app.use(express.static(publicDir));

// ==========================================
// FILE UPLOAD CONFIG
// ==========================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const safeExt = path.extname(file.originalname).toLowerCase();
        const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
        if (!allowedExt.includes(safeExt)) return cb(new Error('Only JPG, PNG or WEBP images are allowed'));
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
        cb(null, true);
    }
});

// ==========================================
// EMAIL TRANSPORT
// ==========================================
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 465,
        secure: true,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
} else {
    console.warn('⚠️  SMTP credentials missing — emails will be skipped (logged only).');
}

async function sendMail(options) {
    if (!transporter) { console.log('[Email skipped - no SMTP configured]', options.subject); return; }
    try { await transporter.sendMail(options); }
    catch (err) { console.error('Email dispatch failed:', err.message); }
}

// ---------- HTML EMAIL TEMPLATES ----------
function brandWrap(innerHtml) {
    return `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f4f2;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e6e2d8;">
        <div style="background:#1c2733;padding:18px 24px;border-bottom:4px solid #ff7a1a;">
          <span style="color:#ff7a1a;font-weight:800;font-size:18px;">LINEA</span><span style="color:#fff;font-weight:800;font-size:18px;">LED</span>
          <div style="color:#9fb0c4;font-size:11px;letter-spacing:1px;margin-top:2px;">SIGNAGE SERVICE NETWORK</div>
        </div>
        <div style="padding:26px 24px;color:#222;font-size:14px;line-height:1.55;">${innerHtml}</div>
        <div style="background:#f4f4f2;padding:14px 24px;color:#8a93a0;font-size:11px;">© 2026 Linea LED Signage Networks</div>
      </div>
    </div>`;
}

function customerRegisterEmail(r) {
    return brandWrap(`
        <p>Dear <b>${r.contact_name}</b>,</p>
        <p>Your signage service complaint has been <b style="color:#1d7a45">successfully registered</b>.</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">
          <tr><td style="padding:6px 0;color:#777;width:40%;">Ticket ID</td><td style="padding:6px 0;font-weight:700;">${r.ticket_id}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Warranty ID</td><td style="padding:6px 0;">${r.warranty_id}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Client / Branch</td><td style="padding:6px 0;">${r.client_name}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Issue Reported</td><td style="padding:6px 0;">${r.issue_reported}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Warranty Status</td><td style="padding:6px 0;font-weight:700;color:${r.in_warranty ? '#1d7a45' : '#a13a23'}">${r.in_warranty ? 'In Warranty' : 'Not In Warranty'}</td></tr>
        </table>
        <p>Our service team has queued your ticket and will contact you shortly. You can track live status anytime on our dashboard.</p>
        <p style="margin-top:18px;">Regards,<br><b>Linea LED Service Desk</b></p>
    `);
}

function adminRegisterEmail(r) {
    return brandWrap(`
        <p><b style="color:#ff7a1a;">NEW COMPLAINT RECEIVED</b></p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">
          <tr><td style="padding:6px 0;color:#777;width:40%;">Ticket ID</td><td style="padding:6px 0;font-weight:700;">${r.ticket_id}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Client / Branch</td><td style="padding:6px 0;">${r.client_name}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Contact</td><td style="padding:6px 0;">${r.contact_name} (${r.contact_phone})</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Warranty ID</td><td style="padding:6px 0;">${r.warranty_id}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Warranty Status</td><td style="padding:6px 0;font-weight:700;color:${r.in_warranty ? '#1d7a45' : '#a13a23'}">${r.in_warranty ? 'In Warranty' : 'Not In Warranty'}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Site Address</td><td style="padding:6px 0;">${r.site_address || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">GPS</td><td style="padding:6px 0;">${r.gps_lat && r.gps_lng ? `${r.gps_lat}, ${r.gps_lng}` : '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#777;">Issue</td><td style="padding:6px 0;">${r.issue_reported}</td></tr>
        </table>
        <p>Open the admin console to assign a field engineer.</p>
    `);
}

function statusUpdateEmail(r) {
    return brandWrap(`
        <p>Dear <b>${r.contact_name}</b>,</p>
        <p>There's an update on your ticket <b>${r.ticket_id}</b>.</p>
        <p style="font-size:16px;margin:16px 0;">New Status: <b style="color:#ff7a1a;">${r.status}</b></p>
        <p>Thank you for your patience.</p>
        <p style="margin-top:18px;">Regards,<br><b>Linea LED Service Desk</b></p>
    `);
}

// ==========================================
// WHATSAPP GATEWAY (pluggable, templated)
// ==========================================
async function sendWhatsApp(number, message) {
    const provider = process.env.WHATSAPP_PROVIDER || 'mock';
    if (provider === 'mock') { console.log(`[MOCK WhatsApp -> ${number}]: ${message}`); return { success: true, mocked: true }; }
    if (provider === 'meta') {
        try {
            const resp = await fetch(`https://graph.facebook.com/v20.0/${process.env.META_WA_PHONE_ID}/messages`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.META_WA_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { body: message } })
            });
            return { success: resp.ok, data: await resp.json() };
        } catch (err) { console.error('WhatsApp send failed:', err.message); return { success: false }; }
    }
    return { success: false };
}

function waCustomerRegister(r) {
    return `✅ *Linea LED Service*\nHi ${r.contact_name}, your complaint *#${r.ticket_id}* is registered.\nWarranty: ${r.in_warranty ? 'In Warranty ✅' : 'Not In Warranty ⚠️'}\nIssue: ${r.issue_reported}\nOur team will reach out shortly.`;
}
function waAdminRegister(r) {
    return `🔔 *New Complaint* #${r.ticket_id}\nClient: ${r.client_name}\nContact: ${r.contact_name} (${r.contact_phone})\nWarranty: ${r.in_warranty ? 'In Warranty' : 'Not In Warranty'}\nIssue: ${r.issue_reported}`;
}
function waStatusUpdate(r) {
    return `🔄 *Linea LED Update*\nTicket #${r.ticket_id} status changed to: *${r.status}*`;
}

// ==========================================
// ADMIN AUTH
// ==========================================
function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!ADMIN_API_KEY || key !== ADMIN_API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized. Valid x-admin-key header required.' });
    next();
}

// ==========================================
// VALIDATION
// ==========================================
const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0;
const isValidPhone = v => typeof v === 'string' && /^[0-9+\-\s]{8,15}$/.test(v.trim());

// ==========================================
// WARRANTY LOOKUP (used by scan-to-prefill + registration matching)
// ==========================================
function lookupWarranty(warrantyId) {
    if (!warrantyId) return null;
    return db.prepare('SELECT * FROM warranties WHERE warranty_id = ?').get(warrantyId.trim());
}
function isWithinWarranty(record) {
    if (!record) return false;
    const today = new Date().toISOString().slice(0, 10);
    return today >= record.start_date && today <= record.end_date;
}

// PUBLIC: called when customer scans QR — auto-fills warranty/client/address fields
app.get('/api/warranty-lookup/:warrantyId', (req, res) => {
    const record = lookupWarranty(req.params.warrantyId);
    if (!record) return res.json({ success: true, found: false });
    res.json({
        success: true,
        found: true,
        inWarranty: isWithinWarranty(record),
        data: {
            warrantyId: record.warranty_id,
            clientName: record.customer_name,
            branchName: record.branch_name,
            siteAddress: record.site_address,
            endDate: record.end_date
        }
    });
});

// ==========================================
// ROUTES: COMPLAINTS
// ==========================================
app.post(
    '/api/register-complaint',
    submitLimiter,
    upload.fields([{ name: 'photo1', maxCount: 1 }, { name: 'photo2', maxCount: 1 }, { name: 'photo3', maxCount: 1 }]),
    async (req, res) => {
        try {
            const { warrantyId, clientName, contactName, contactPhone, contactEmail, siteAddress, issueReported, gpsLat, gpsLng } = req.body;

            const errors = [];
            if (!isNonEmptyString(warrantyId)) errors.push('warrantyId is required');
            if (!isNonEmptyString(clientName)) errors.push('clientName is required');
            if (!isNonEmptyString(contactName)) errors.push('contactName is required');
            if (!isValidPhone(contactPhone)) errors.push('contactPhone must be a valid phone number');
            if (!isNonEmptyString(issueReported)) errors.push('issueReported is required');
            if (errors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors });

            const warrantyRecord = lookupWarranty(warrantyId);
            const inWarranty = isWithinWarranty(warrantyRecord);
            const matchNote = !warrantyRecord ? 'Warranty ID not found in database' : (inWarranty ? 'Active warranty match' : 'Warranty expired or not started');

            const ticketId = `LIN-${Math.floor(100000 + Math.random() * 900000)}`;
            const files = req.files || {};

            db.prepare(`
                INSERT INTO complaints
                (ticket_id, warranty_id, client_name, contact_name, contact_phone, contact_email, site_address, issue_reported, photo1_path, photo2_path, photo3_path, status, gps_lat, gps_lng, in_warranty, warranty_match_note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                ticketId, warrantyId.trim(), clientName.trim(), contactName.trim(), contactPhone.trim(),
                contactEmail ? contactEmail.trim() : null, siteAddress ? siteAddress.trim() : null, issueReported.trim(),
                files.photo1 ? `/uploads/${files.photo1[0].filename}` : null,
                files.photo2 ? `/uploads/${files.photo2[0].filename}` : null,
                files.photo3 ? `/uploads/${files.photo3[0].filename}` : null,
                'Open', gpsLat || null, gpsLng || null, inWarranty ? 1 : 0, matchNote
            );

            const record = db.prepare('SELECT * FROM complaints WHERE ticket_id = ?').get(ticketId);

            const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER;
            const adminPhone = process.env.ADMIN_NOTIFY_PHONE;

            sendMail({ from: process.env.SMTP_USER, to: adminEmail, subject: `New Complaint #${ticketId} — ${clientName}`, html: adminRegisterEmail(record) });
            if (contactEmail) sendMail({ from: process.env.SMTP_USER, to: contactEmail, subject: `Complaint Logged - Ticket #${ticketId}`, html: customerRegisterEmail(record) });

            sendWhatsApp(contactPhone, waCustomerRegister(record));
            if (adminPhone) sendWhatsApp(adminPhone, waAdminRegister(record));

            return res.status(201).json({ success: true, message: 'Complaint registered successfully', data: record });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: 'Server error while registering complaint' });
        }
    }
);

app.get('/api/get-complaints', (req, res) => {
    const records = db.prepare('SELECT id, ticket_id, warranty_id, client_name, site_address, issue_reported, status, in_warranty, warranty_match_note, gps_lat, gps_lng, created_at FROM complaints ORDER BY id DESC').all();
    // Enrich with city from warranty table
    const enriched = records.map(r => {
        const w = db.prepare('SELECT city_name FROM warranties WHERE warranty_id = ?').get(r.warranty_id);
        return { ...r, city_name: w ? w.city_name : null };
    });
    res.json({ success: true, data: enriched });
});

app.get('/api/admin/complaints', requireAdmin, (req, res) => {
    res.json({ success: true, data: db.prepare('SELECT * FROM complaints ORDER BY id DESC').all() });
});

app.get('/api/admin/complaints/export', (req, res) => {
    const key = req.headers['x-admin-key'] || req.query.key;
    if (!ADMIN_API_KEY || key !== ADMIN_API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const rows = db.prepare('SELECT * FROM complaints ORDER BY id DESC').all();
    const headers = ['ticket_id','warranty_id','client_name','contact_name','contact_phone','contact_email','site_address','issue_reported','status','in_warranty','created_at'];
    const csv = [headers.join(',')].concat(
        rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(','))
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="linea_complaints.csv"');
    res.send(csv);
});

app.patch('/api/admin/complaints/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const allowed = ['Open', 'In Progress', 'Resolved'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: `status must be one of ${allowed.join(', ')}` });

    const result = db.prepare('UPDATE complaints SET status = ? WHERE id = ?').run(status, req.params.id);
    if (result.changes === 0) return res.status(404).json({ success: false, message: 'Complaint not found' });

    const record = db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id);
    if (record.contact_email) sendMail({ from: process.env.SMTP_USER, to: record.contact_email, subject: `Ticket #${record.ticket_id} - Status Updated`, html: statusUpdateEmail(record) });
    sendWhatsApp(record.contact_phone, waStatusUpdate(record));

    res.json({ success: true, message: 'Status updated', data: record });
});

// ==========================================
// ROUTES: WARRANTIES
// ==========================================
app.get('/api/warranties', (req, res) => {
    res.json({ success: true, data: db.prepare('SELECT * FROM warranties ORDER BY id DESC').all() });
});

// ---------- CSV helpers ----------
// Proper CSV line parser that respects quoted fields containing commas
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], next = text[i + 1];
        if (inQuotes) {
            if (c === '"' && next === '"') { field += '"'; i++; }
            else if (c === '"') { inQuotes = false; }
            else { field += c; }
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\r') { /* skip */ }
            else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else field += c;
        }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

// Accepts DD-MM-YYYY (dash) or MM/DD/YYYY (slash) — matches the export formats seen in real data
function parseFlexibleDate(str) {
    if (!str) return null;
    str = str.trim();
    let m;
    if ((m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) {
        // DD-MM-YYYY
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return isNaN(d.getTime()) ? null : d;
    }
    if ((m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
        // MM/DD/YYYY
        const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
        return isNaN(d.getTime()) ? null : d;
    }
    if ((m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
        // YYYY-MM-DD
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
    }
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}
function toISODate(d) { return d.toISOString().slice(0, 10); }

app.post('/api/admin/warranties', requireAdmin, (req, res) => {
    const { warrantyId, customerName, branchName, contactNumber, siteAddress, warrantyMonths, startDate } = req.body;
    if (!isNonEmptyString(warrantyId) || !isNonEmptyString(customerName) || !isNonEmptyString(startDate)) {
        return res.status(400).json({ success: false, message: 'warrantyId, customerName and startDate are required' });
    }
    const months = Number(warrantyMonths) || 12;
    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    try {
        db.prepare(`INSERT INTO warranties (warranty_id, customer_name, branch_name, contact_number, site_address, warranty_months, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(warrantyId.trim(), customerName.trim(), branchName || null, contactNumber || null, siteAddress || null, months, start.toISOString().slice(0,10), end.toISOString().slice(0,10));
        res.status(201).json({ success: true, message: 'Warranty record created' });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'warrantyId already exists' });
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// BULK CSV UPLOAD — accepts the standard Linea export header directly:
// Warranty ID, Customer Name, Registration Status, Total Warranty, Warranty Start Date,
// Warranty End Date, Registration Date, SKU ID, SKU Name, Brand, Email, Project Name,
// Converter Name, Contact Person Number, Contact Person Name, Site Address, City Name,
// Pin Code, Product Name, Product Type
// (Also still accepts the simpler warrantyId,customerName,...,startDate header for manual entries.)
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
app.post('/api/admin/warranties/bulk-upload', requireAdmin, csvUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'CSV file is required (field name: file)' });

    const text = req.file.buffer.toString('utf-8');
    const allRows = parseCsv(text);
    if (allRows.length < 2) return res.status(400).json({ success: false, message: 'CSV has no data rows' });

    const headers = allRows[0].map(h => h.trim());
    const dataRows = allRows.slice(1);

    // Detect which header format we're dealing with
    const isFullExport = headers.includes('Warranty ID') && headers.includes('Customer Name');
    const isSimple = headers.includes('warrantyId') && headers.includes('customerName');

    if (!isFullExport && !isSimple) {
        return res.status(400).json({ success: false, message: 'Unrecognized CSV header. Expected the standard Linea export columns (Warranty ID, Customer Name, ...) or the simple format (warrantyId, customerName, ...).' });
    }

    const insertStmt = db.prepare(`
        INSERT INTO warranties
        (warranty_id, customer_name, branch_name, contact_number, contact_person_name, email, site_address, city_name, pin_code, registration_status, product_name, product_type, sku_name, brand, warranty_months, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(warranty_id) DO UPDATE SET
          customer_name=excluded.customer_name, branch_name=excluded.branch_name, contact_number=excluded.contact_number,
          contact_person_name=excluded.contact_person_name, email=excluded.email, site_address=excluded.site_address,
          city_name=excluded.city_name, pin_code=excluded.pin_code, registration_status=excluded.registration_status,
          product_name=excluded.product_name, product_type=excluded.product_type, sku_name=excluded.sku_name, brand=excluded.brand,
          warranty_months=excluded.warranty_months, start_date=excluded.start_date, end_date=excluded.end_date
    `);

    let inserted = 0, failed = 0;
    const errors = [];

    const insertOne = (cells, idx) => {
        const rowNum = idx + 2;
        const row = {};
        headers.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });

        if (isFullExport) {
            const warrantyId = row['Warranty ID'];
            const customerName = row['Customer Name'];
            if (!warrantyId || !customerName) { failed++; errors.push(`Row ${rowNum}: missing Warranty ID or Customer Name`); return; }

            const startD = parseFlexibleDate(row['Warranty Start Date']);
            const endD = parseFlexibleDate(row['Warranty End Date']);
            if (!startD || !endD) { failed++; errors.push(`Row ${rowNum}: invalid date (start="${row['Warranty Start Date']}" end="${row['Warranty End Date']}")`); return; }

            const monthsMatch = (row['Total Warranty'] || '').match(/(\d+)/);
            const years = monthsMatch ? Number(monthsMatch[1]) : null;
            const months = years ? (row['Total Warranty'].toLowerCase().includes('year') ? years * 12 : years) : Math.round((endD - startD) / (1000 * 60 * 60 * 24 * 30));

            insertStmt.run(
                warrantyId, customerName, row['Project Name'] || null, row['Contact Person Number'] || null,
                row['Contact Person Name'] || null, (row['Email'] && row['Email'] !== '-') ? row['Email'] : null,
                row['Site Address'] || null, row['City Name'] || null, row['Pin Code'] || null,
                row['Registration Status'] || null, row['Product Name'] || null, row['Product Type'] || null,
                row['SKU Name'] || null, row['Brand'] || null, months || 12, toISODate(startD), toISODate(endD)
            );
            inserted++;
        } else {
            const warrantyId = row.warrantyId, customerName = row.customerName;
            if (!warrantyId || !customerName || !row.startDate) { failed++; errors.push(`Row ${rowNum}: missing required field`); return; }
            const months = Number(row.warrantyMonths) || 12;
            const start = parseFlexibleDate(row.startDate);
            if (!start) { failed++; errors.push(`Row ${rowNum}: invalid startDate "${row.startDate}"`); return; }
            const end = new Date(start);
            end.setMonth(end.getMonth() + months);
            insertStmt.run(
                warrantyId, customerName, row.branchName || null, row.contactNumber || null,
                null, null, row.siteAddress || null, null, null, null, null, null, null, null,
                months, toISODate(start), toISODate(end)
            );
            inserted++;
        }
    };

    // Wrap in an explicit transaction: much faster for large CSVs and ensures
    // we don't end up with a half-committed state if something throws mid-way.
    const runBulk = db.transaction((rows) => {
        rows.forEach((cells, idx) => {
            try { insertOne(cells, idx); }
            catch (err) { failed++; errors.push(`Row ${idx + 2}: ${err.message}`); }
        });
    });

    try {
        runBulk(dataRows);
    } catch (err) {
        console.error('Bulk warranty upload transaction failed:', err);
        return res.status(500).json({ success: false, message: `Upload failed: ${err.message}` });
    }

    const totalNow = db.prepare('SELECT COUNT(*) AS c FROM warranties').get().c;
    console.log(`[CSV Upload] Processed ${dataRows.length} rows -> inserted/updated ${inserted}, failed ${failed}. Total warranties in DB now: ${totalNow}`);

    res.json({ success: true, message: `Processed ${dataRows.length} rows`, inserted, failed, totalInDb: totalNow, errors: errors.slice(0, 30) });
});

// ==========================================
// QR GENERATOR — encodes deep-link that prefills the complaint form
// ==========================================
app.post('/api/qr', requireAdmin, async (req, res) => {
    const { warrantyId, branchName, siteAddress } = req.body;
    if (!isNonEmptyString(warrantyId)) return res.status(400).json({ success: false, message: 'warrantyId is required' });

    const base = process.env.FRONTEND_URL || process.env.ALLOWED_ORIGIN || '';
    const params = new URLSearchParams({ warrantyId, branch: branchName || '', address: siteAddress || '' });
    const targetUrl = `${base}/register.html?${params.toString()}`;
    try {
        const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 400, margin: 2, color: { dark: '#1c2733', light: '#ffffff' } });
        res.json({ success: true, qr: qrDataUrl, url: targetUrl });
    } catch (err) {
        res.status(500).json({ success: false, message: 'QR generation failed' });
    }
});

app.get('/api/health', (req, res) => {
    const wCount = db.prepare('SELECT COUNT(*) AS c FROM warranties').get().c;
    const cCount = db.prepare('SELECT COUNT(*) AS c FROM complaints').get().c;
    res.json({ success: true, status: 'Linea backend running', warrantiesInDb: wCount, complaintsInDb: cCount });
});

app.use((err, req, res, next) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Unexpected error' });
    next();
});

app.listen(PORT, () => console.log(`Linea LED backend running on port ${PORT}`));

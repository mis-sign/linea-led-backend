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

app.use(express.json());
// Hamein har jagah se request allow karni hai
app.use(cors({ origin: '*' }));

// Static files serve karne ke liye - DOCS FOLDER
const docsDir = path.join(__dirname, 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir);
app.use(express.static(docsDir));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Too many submissions from this device. Please try again later.' }
});

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
}

async function sendMail(options) {
    if (!transporter) return;
    try { await transporter.sendMail(options); }
    catch (err) { console.error('Email dispatch failed:', err.message); }
}

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
// WHATSAPP GATEWAY
// ==========================================
async function sendWhatsApp(number, message) {
    const provider = process.env.WHATSAPP_PROVIDER || 'mock';
    if (provider === 'mock') return { success: true, mocked: true };
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
    return `✅ *Linea LED Service*\nHi ${r.contact_name}, your complaint *#${r.ticket_id}* is registered.\nWarranty: ${r.in_warranty ? 'In Warranty ✅' : 'Not In Warranty ⚠️'}\nIssue: ${r.issue_reported}`;
}
function waAdminRegister(r) {
    return `🔔 *New Complaint* #${r.ticket_id}\nClient: ${r.client_name}\nContact: ${r.contact_name}\nIssue: ${r.issue_reported}`;
}
function waStatusUpdate(r) {
    return `🔄 *Linea LED Update*\nTicket #${r.ticket_id} status changed to: *${r.status}*`;
}

function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!ADMIN_API_KEY || key !== ADMIN_API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized.' });
    next();
}

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0;
const isValidPhone = v => typeof v === 'string' && /^[0-9+\-\s]{8,15}$/.test(v.trim());

function lookupWarranty(warrantyId) {
    if (!warrantyId) return null;
    return db.prepare('SELECT * FROM warranties WHERE warranty_id = ?').get(warrantyId.trim());
}
function isWithinWarranty(record) {
    if (!record) return false;
    const today = new Date().toISOString().slice(0, 10);
    return today >= record.start_date && today <= record.end_date;
}

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
            if (!isValidPhone(contactPhone)) errors.push('contactPhone must be valid');
            if (!isNonEmptyString(issueReported)) errors.push('issueReported is required');
            if (errors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors });

            const warrantyRecord = lookupWarranty(warrantyId);
            const inWarranty = isWithinWarranty(warrantyRecord);
            const matchNote = !warrantyRecord ? 'Warranty ID not found' : (inWarranty ? 'Active warranty' : 'Expired');

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

            sendMail({ from: process.env.SMTP_USER, to: adminEmail, subject: `New Complaint #${ticketId}`, html: adminRegisterEmail(record) });
            if (contactEmail) sendMail({ from: process.env.SMTP_USER, to: contactEmail, subject: `Complaint Logged #${ticketId}`, html: customerRegisterEmail(record) });

            sendWhatsApp(contactPhone, waCustomerRegister(record));
            if (adminPhone) sendWhatsApp(adminPhone, waAdminRegister(record));

            return res.status(201).json({ success: true, message: 'Complaint registered', data: record });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: 'Server error' });
        }
    }
);

app.get('/api/get-complaints', (req, res) => {
    const records = db.prepare('SELECT * FROM complaints ORDER BY id DESC').all();
    res.json({ success: true, data: records });
});

app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'Linea backend running' });
});

app.use((err, req, res, next) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
});

app.listen(PORT, () => console.log(`Linea LED backend running on port ${PORT}`));
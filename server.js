require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 3000;

// MySQL connection pool
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files safely
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// File upload configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.pdf');
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

// --- Admin Auth and Paper Management ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ error: 'Admin authentication required' });
    }
}

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pages/:page', (req, res) => {
    const page = req.params.page;
    // Basic path traversal prevention
    if (page.includes('..') || page.includes('/') || page.includes('\\')) {
        return res.status(403).json({ error: 'Invalid page request' });
    }
    const filePath = path.join(__dirname, 'pages', page);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'Page not found' });
    }
});

// Authentication routes
app.post('/api/signin', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'examurai2024';
    try {
        // Check if user exists
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        let user = rows[0];

        if (!user) {
            // Register new user with default password
            const hashedPassword = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
            const [result] = await db.query(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                [email, hashedPassword, email.split('@')[0]]
            );
            // Fetch the new user with join date
            const [newUserRows] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
            user = newUserRows[0];
        } else {
            // Only allow sign-in if password matches the default
            if (!bcrypt.compareSync(DEFAULT_PASSWORD, user.password)) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
        }

        req.session.user = { id: user.id, email: user.email, name: user.name };
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                joinedDate: user.joined_date
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/signout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error signing out' });
        }
        res.json({ success: true, message: 'Signed out successfully' });
    });
});

app.post('/google-signin', express.json(), async (req, res) => {
    const { id_token } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: id_token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name;
        // Check if user exists
        let [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        let user = rows[0];
        if (!user) {
            // Create user with a random password (not used for Google sign-in)
            const [result] = await db.query(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                [email, '', name]
            );
            [rows] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
            user = rows[0];
        }
        req.session.user = { id: user.id, email: user.email, name: user.name };
        res.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, email, name, joined_date FROM users WHERE id = ?', [req.session.user.id]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Get bookmarks and contributions count
        const [bookmarks] = await db.query('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?', [user.id]);
        const [contributions] = await db.query('SELECT COUNT(*) as count FROM papers WHERE user_id = ?', [user.id]);

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            joinedDate: user.joined_date,
            bookmarks: bookmarks[0].count,
            contributions: contributions[0].count
        });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Query and message submission
app.post('/api/submit-query', async (req, res) => {
    const { searchQuery, description } = req.body;
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: 'New Query from Examurai',
        html: `
            <h2>New Query Submitted</h2>
            <p><strong>Search Query:</strong> ${searchQuery || 'Not provided'}</p>
            <p><strong>Description:</strong> ${description || 'Not provided'}</p>
            <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
        `
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Email error:', error);
            res.status(500).json({ error: 'Failed to send query. ' + error.message });
        } else {
            res.json({ success: true, message: 'Query submitted successfully!' });
        }
    });
});

app.post('/api/submit-message', async (req, res) => {
    const { name, email, subject, message } = req.body;
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: `Contact Form: ${subject}`,
        html: `
            <h2>New Message from Contact Form</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
            <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
        `
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Email error:', error);
            res.status(500).json({ error: 'Failed to send message. ' + error.message });
        } else {
            res.json({ success: true, message: 'Message sent successfully!' });
        }
    });
});

// Upload paper (requires authentication)
app.post('/api/upload-paper', requireAuth, upload.single('paper'), async (req, res) => {
    try {
        const { name, college, branch, semester, subject } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        // Insert the new paper without the year field
        await db.query(
            'INSERT INTO papers (user_id, name, college, course, semester, subject, filename, original_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.session.user.id, name, college, branch, semester, subject, file.filename, file.originalname]
        );

        res.json({ success: true, message: 'Paper uploaded successfully!' });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload paper' });
    }
});

// Download paper (requires authentication)
app.get('/api/download/:paperId', requireAuth, async (req, res) => {
    const paperId = req.params.paperId;
    try {
        const [rows] = await db.query('SELECT filename, original_name FROM papers WHERE id = ?', [paperId]);
        if (!rows.length) {
            return res.status(404).json({ error: 'Paper not found' });
        }
        const { filename, original_name } = rows[0];
        const filePath = path.join(__dirname, 'uploads', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        res.download(filePath, original_name || filename);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Get user contributions (papers uploaded)
app.get('/api/contributions', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM papers WHERE user_id = ? ORDER BY uploaded_at DESC',
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get user bookmarks
app.get('/api/bookmarks', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT b.id, b.paper_id, p.subject, p.college, p.filename, b.added_at
             FROM bookmarks b
             JOIN papers p ON b.paper_id = p.id
             WHERE b.user_id = ?`, [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Add bookmark
app.post('/api/bookmarks', requireAuth, async (req, res) => {
    const { paperId } = req.body;
    try {
        await db.query(
            'INSERT INTO bookmarks (user_id, paper_id) VALUES (?, ?)',
            [req.session.user.id, paperId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Remove bookmark
app.delete('/api/bookmarks/:id', requireAuth, async (req, res) => {
    const bookmarkId = req.params.id;
    try {
        await db.query(
            'DELETE FROM bookmarks WHERE id = ? AND user_id = ?',
            [bookmarkId, req.session.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all colleges with paper counts
app.get('/api/colleges', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT college, COUNT(*) as paper_count FROM papers GROUP BY college ORDER BY paper_count DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Search and browse the public paper library.
app.get('/api/papers', async (req, res) => {
    const { q = '', subject, branch, college, page = '1', limit = '24' } = req.query;
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageSize = Math.min(60, Math.max(1, Number.parseInt(limit, 10) || 24));
    const conditions = ['approved = 1'];
    const values = [];

    for (const [column, value] of [['subject', subject], ['course', branch], ['college', college]]) {
        if (typeof value === 'string' && value.trim()) {
            conditions.push(`${column} = ?`);
            values.push(value.trim());
        }
    }
    if (typeof q === 'string' && q.trim()) {
        const term = `%${q.trim()}%`;
        conditions.push('(subject LIKE ? OR name LIKE ? OR college LIKE ? OR course LIKE ?)');
        values.push(term, term, term, term);
    }

    try {
        const where = conditions.join(' AND ');
        const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM papers WHERE ${where}`, values);
        const [rows] = await db.query(
            `SELECT id, name, college, course, semester, subject, original_name, uploaded_at
             FROM papers WHERE ${where} ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`,
            [...values, pageSize, (pageNumber - 1) * pageSize]
        );
        res.json({ papers: rows, total: countRows[0].total, page: pageNumber, limit: pageSize });
    } catch (err) {
        console.error('Paper search error:', err);
        res.status(500).json({ error: 'Unable to load papers' });
    }
});

// Get all branches for a college with paper counts
app.get('/api/colleges/:college/branches', async (req, res) => {
    const college = req.params.college;
    try {
        const [rows] = await db.query(
            `SELECT course AS branch, COUNT(*) as paper_count FROM papers WHERE college = ? GROUP BY course ORDER BY paper_count DESC`,
            [college]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all papers for a college (optionally filter by branch)
app.get('/api/colleges/:college/papers', async (req, res) => {
    const college = req.params.college;
    const branch = req.query.branch;
    try {
        let query = 'SELECT * FROM papers WHERE college = ?';
        let params = [college];
        if (branch) {
            query += ' AND course = ?';
            params.push(branch);
        }
        query += ' ORDER BY uploaded_at DESC';
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all unique branches (courses)
app.get('/api/branches', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT course AS branch FROM papers ORDER BY branch');
        res.json(rows.map(r => r.branch));
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all unique subjects
app.get('/api/subjects', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT subject FROM papers ORDER BY subject');
        res.json(rows.map(r => r.subject));
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all papers for a branch (across colleges)
app.get('/api/branches/:branch/papers', async (req, res) => {
    const branch = req.params.branch;
    try {
        const [rows] = await db.query('SELECT * FROM papers WHERE course = ? ORDER BY uploaded_at DESC', [branch]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all papers for a subject (across colleges)
app.get('/api/subjects/:subject/papers', async (req, res) => {
    const subject = req.params.subject;
    try {
        const [rows] = await db.query('SELECT * FROM papers WHERE subject = ? ORDER BY uploaded_at DESC', [subject]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin routes
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        return res.status(503).json({ error: 'Admin login is not configured' });
    }
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid admin credentials' });
    }
});

app.get('/api/admin/papers', requireAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT p.id, p.name, p.original_name, p.filename, p.uploaded_at, p.approved, u.email as user_email
             FROM papers p
             LEFT JOIN users u ON p.user_id = u.id
             WHERE p.approved = 0
             ORDER BY p.uploaded_at DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/admin/papers/:id/approve', requireAdmin, async (req, res) => {
    const paperId = req.params.id;
    try {
        await db.query('UPDATE papers SET approved = 1 WHERE id = ?', [paperId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/admin/papers/:id/remove', requireAdmin, async (req, res) => {
    const paperId = req.params.id;
    try {
        // Optionally, delete the file from disk as well
        const [rows] = await db.query('SELECT filename FROM papers WHERE id = ?', [paperId]);
        if (rows.length) {
            const filePath = path.join(__dirname, 'uploads', rows[0].filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        await db.query('DELETE FROM papers WHERE id = ?', [paperId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Examurai backend is ready!');
}); 

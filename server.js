// server.js
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');
const exceljs = require('exceljs');
const session = require('express-session'); // Sessions
const bcrypt = require('bcrypt');          // Password hashing
const winston = require('winston');        // Logging
const { format } = require('winston');     // Logging format helpers

const app = express();
const PORT = 3000;

// --- Setup Logger ---
const logger = winston.createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS ZZ' }), // Precise timestamp
        format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'action.log' }) // Log file
    ]
});

// Middleware
app.use(cors()); // Allow requests from frontend (if on different port during dev)
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.set('trust proxy', true); // Get real IP behind proxy

// --- Setup Session Middleware ---
app.use(session({
    secret: 'replace-this-with-a-long-random-string-in-production', // IMPORTANT: Change this!
    resave: false,
    saveUninitialized: false, // Don't save sessions until login
    cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true, // Prevent client-side JS access
        maxAge: 24 * 60 * 60 * 1000 // Session duration: 1 day
    }
}));

// Serve static files from 'public' directory AFTER session setup
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Pool
const dbConfig = {
    host: 'localhost',
    user: 'root', // Your MySQL username
    password: 'Aarav@1311', // Your MySQL password
    database: 'event_manager',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
};
const pool = mysql.createPool(dbConfig);

// --- Authentication Middleware ---
// Protects routes that require login
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        logger.warn(`Unauthorized access attempt to ${req.originalUrl} from IP: ${req.ip}`);
        if (req.originalUrl.startsWith('/api/')) {
           return res.status(401).json({ success: false, message: 'Authentication required.' });
        } else {
           // Redirect non-API requests to the login page
           return res.redirect('/Login');F
        }
    }
    // If logged in, proceed to the next middleware or route handler
    next();
};

// --- Log Action Function ---
// Helper to standardize log messages
const logAction = (username, action, ipAddress, details = '') => {
    const message = `Admin: ${username}, IP: ${ipAddress}, Action: ${action}${details ? `, Details: ${details}` : ''}`;
    logger.info(message);
};

// --- API ENDPOINTS ---

// --- Login Route ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ipAddress = req.ip; // Get client IP address
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT * FROM admins WHERE username = ?', [username]);
        connection.release();

        if (rows.length === 0) {
            logger.warn(`Login Failed: Username '${username}' not found. IP: ${ipAddress}`);
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const admin = rows[0];
        // Compare provided password with the hashed password in the database
        const match = await bcrypt.compare(password, admin.password);

        if (match) {
            // Store user ID and username in session upon successful login
            req.session.userId = admin.id;
            req.session.username = admin.username;
            logAction(admin.username, 'Logged In', ipAddress);
            res.json({ success: true, message: 'Login successful!' });
        } else {
            logger.warn(`Login Failed: Incorrect password for username '${username}'. IP: ${ipAddress}`);
            res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
    } catch (error) {
        if (connection) connection.release();
        logger.error(`Login Error: ${error.message}. Username: ${username}, IP: ${ipAddress}`);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// --- Logout Route ---
app.post('/api/logout', (req, res) => {
    const username = req.session.username || 'Unknown user';
    const ipAddress = req.ip;
    req.session.destroy(err => {
        if (err) {
            logger.error(`Logout Error for ${username}: ${err.message}. IP: ${ipAddress}`);
            return res.status(500).json({ success: false, message: 'Logout failed.' });
        }
        logAction(username, 'Logged Out', ipAddress);
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.json({ success: true, message: 'Logged out successfully.' });
    });
});

// --- Check Login Status Route ---
// Used by frontend to verify if user is still logged in
app.get('/api/auth/status', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// --- PROTECTED API ENDPOINTS (require requireLogin middleware) ---

// Dashboard Summary
app.get('/api/summary', requireLogin, async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        // Fetch stats, chart data, top users, activity feed
        const [candidateRows] = await connection.execute('SELECT COUNT(*) as total FROM candidates');
        const [pointsRows] = await connection.execute('SELECT COALESCE(SUM(points), 0) as total FROM points_log');
        const [attendanceRows] = await connection.execute('SELECT COUNT(*) as total FROM attendance');
        const [barChartData] = await connection.execute(`SELECT DATE(awarded_at) as date, SUM(points) as total FROM points_log GROUP BY DATE(awarded_at) ORDER BY date DESC LIMIT 7`);
        const [topUsersData] = await connection.execute(`SELECT c.uid, c.name, COALESCE(SUM(pl.points), 0) as total FROM candidates c LEFT JOIN points_log pl ON c.uid = pl.candidate_uid GROUP BY c.uid, c.name ORDER BY total DESC LIMIT 3`);
        const [activityFeed] = await connection.execute(`SELECT c.name, pl.reason, pl.points, pl.awarded_at FROM points_log pl JOIN candidates c ON c.uid = pl.candidate_uid ORDER BY pl.awarded_at DESC LIMIT 5`);
        connection.release();
        res.json({
            success: true,
            stats: { totalCandidates: candidateRows[0].total, totalPoints: pointsRows[0].total, totalAttendance: attendanceRows[0].total, },
            charts: { pointsPerDay: barChartData.reverse(), topUsers: topUsersData, },
            feed: activityFeed,
        });
    } catch (error) {
        if (connection) connection.release();
        logger.error(`Dashboard Summary Error: ${error.message}`); // Log errors
        res.status(500).json({ success: false, message: 'Failed to load dashboard data.' });
    }
});

// Excel Backup
app.get('/api/backup/excel', requireLogin, async (req, res) => {
    const username = req.session.username;
    const ipAddress = req.ip;
    let connection;
    try {
        connection = await pool.getConnection();
        const [candidates] = await connection.execute('SELECT * FROM candidates');
        const [points_log] = await connection.execute('SELECT * FROM points_log');
        const [attendance] = await connection.execute('SELECT * FROM attendance');
        connection.release();

        const workbook = new exceljs.Workbook();
        workbook.creator = 'Aarav Programmers';
        workbook.created = new Date();
        // Candidates Sheet
        const candidateSheet = workbook.addWorksheet('Candidates');
        candidateSheet.columns = [ { header: 'uid', key: 'uid', width: 10 }, /* ... other cols ... */ { header: 'created_at', key: 'created_at', width: 25 }, ];
        candidateSheet.addRows(candidates);
        // Points Log Sheet
        const pointsSheet = workbook.addWorksheet('Points Log');
        pointsSheet.columns = [ { header: 'log_id', key: 'log_id', width: 10 }, /* ... other cols ... */ { header: 'awarded_at', key: 'awarded_at', width: 25 }, ];
        pointsSheet.addRows(points_log);
        // Attendance Sheet
        const attendanceSheet = workbook.addWorksheet('Attendance');
        attendanceSheet.columns = [ { header: 'attendance_id', key: 'attendance_id', width: 10 }, /* ... other cols ... */ { header: 'attended_at', key: 'attended_at', width: 25 }, ];
        attendanceSheet.addRows(attendance);

        logAction(username, 'Downloaded Backup', ipAddress, 'Success');

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="EventBackup-' + Date.now() + '.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (connection) connection.release();
        logger.error(`Backup Error by ${username}, IP: ${ipAddress}: ${error.message}`);
        logAction(username, 'Attempted Download Backup', ipAddress, `Failed - Error: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Excel backup failed.' });
        }
    }
});

// Create Candidate
app.post('/api/candidates', requireLogin, async (req, res) => {
    const { name, age, phone, gender } = req.body;
    const username = req.session.username;
    const ipAddress = req.ip;
    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.execute(
            'INSERT INTO candidates (name, age, phone, gender) VALUES (?, ?, ?, ?)',
            [name, age, phone, gender]
        );
        connection.release();
        logAction(username, 'Created Candidate', ipAddress, `UID: ${result.insertId}, Name: ${name}`);
        res.status(201).json({ success: true, uid: result.insertId });
    } catch (error) {
        if (connection) connection.release();
        logger.error(`Create Candidate Error by ${username}, IP: ${ipAddress}: ${error.message}`);
        logAction(username, 'Attempted Create Candidate', ipAddress, `Failed - Name: ${name}, Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to create candidate.' });
    }
});

// View Candidate
app.get('/api/candidates', requireLogin, async (req, res) => {
    const { searchTerm } = req.query;
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT * FROM candidates WHERE uid = ? OR name LIKE ?', [searchTerm, `%${searchTerm}%`]);
        if (rows.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Candidate not found' });
        }
        const candidate = rows[0];
        const [pointsRows] = await connection.execute('SELECT SUM(points) as total_points FROM points_log WHERE candidate_uid = ?', [candidate.uid]);
        candidate.total_points = pointsRows[0].total_points || 0;
        const [attendanceRows] = await connection.execute('SELECT event_day FROM attendance WHERE candidate_uid = ?', [candidate.uid]);
        candidate.attendance = attendanceRows.map(row => row.event_day);
        const [logs] = await connection.execute( // Fetch admin username too
            'SELECT points, reason, admin_username, awarded_at FROM points_log WHERE candidate_uid = ? ORDER BY awarded_at DESC',
            [candidate.uid]
        );
        candidate.logs = logs;
        connection.release();
        res.json({ success: true, data: candidate });
    } catch (error) {
        if (connection) connection.release();
         logger.error(`View Candidate Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Error fetching candidate data.' });
    }
});

// View ALL Candidates
app.get('/api/candidates/all', requireLogin, async (req, res) => {
     let connection;
     try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(
            `SELECT c.uid, c.name, c.phone, c.gender,
             COALESCE(SUM(pl.points), 0) as total_points,
             COALESCE(SUM(CASE WHEN DATE(pl.awarded_at) = CURDATE() THEN pl.points ELSE 0 END), 0) as today_points
             FROM candidates c LEFT JOIN points_log pl ON c.uid = pl.candidate_uid
             GROUP BY c.uid, c.name, c.phone, c.gender ORDER BY c.uid ASC`
        );
        connection.release();
        res.json({ success: true, data: rows });
     } catch (error) {
        if (connection) connection.release();
         logger.error(`View All Candidates Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Error fetching all candidates.' });
     }
});

// Add Points Manually
app.post('/api/points', requireLogin, async (req, res) => {
    const { uid, points, reason } = req.body;
    const adminUsername = req.session.username;
    const ipAddress = req.ip;
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT uid FROM candidates WHERE uid = ?', [uid]);
        if (rows.length === 0) {
            connection.release();
            logAction(adminUsername, 'Attempted Add Points', ipAddress, `Failed - UID ${uid} not found`);
            return res.status(404).json({ success: false, message: `Candidate UID ${uid} not found.` });
        }
        await connection.execute(
            'INSERT INTO points_log (candidate_uid, points, reason, admin_username) VALUES (?, ?, ?, ?)',
            [uid, points, reason, adminUsername]
        );
        connection.release();
        logAction(adminUsername, 'Added Points', ipAddress, `UID: ${uid}, Points: ${points}, Reason: ${reason}`);
        res.json({ success: true, message: 'Points added successfully.' });
    } catch (error) {
        if (connection) connection.release();
        logger.error(`Add Points Error by ${adminUsername}, IP: ${ipAddress}: ${error.message}`);
        logAction(adminUsername, 'Attempted Add Points', ipAddress, `Failed - UID: ${uid}, Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to add points.' });
    }
});

// Add event points (Bulk)
app.post('/api/event-points', requireLogin, async (req, res) => {
    const { uids, points, eventName } = req.body;
    const adminUsername = req.session.username;
    const ipAddress = req.ip;
    const uidArray = [...new Set(uids.split(/[\s,;]+/))].filter(uid => uid.trim() !== '' && !isNaN(uid.trim())); // Filter valid UIDs
    let successUIDs = [];
    let failedUIDs = [];
    let connection;
    let overallError = null;

    try {
        connection = await pool.getConnection();
        for (const uid of uidArray) {
            const trimmedUid = uid.trim();
            // No need to check emptiness/NaN again due to filter above
            try {
                const [rows] = await connection.execute('SELECT uid FROM candidates WHERE uid = ?', [trimmedUid]);
                if (rows.length === 0) {
                    failedUIDs.push(trimmedUid);
                    continue;
                }
                await connection.execute(
                    'INSERT INTO points_log (candidate_uid, points, reason, admin_username) VALUES (?, ?, ?, ?)',
                    [trimmedUid, points, eventName, adminUsername]
                );
                successUIDs.push(trimmedUid);
            } catch (insertError) {
                failedUIDs.push(trimmedUid);
                logger.error(`Bulk Event Points Error for UID ${trimmedUid} by ${adminUsername}, IP: ${ipAddress}: ${insertError.message}`);
                overallError = insertError;
            }
        }
        connection.release();

        let message = '';
        if (successUIDs.length > 0) message += `Points added to ${successUIDs.length} user(s). `;
        if (failedUIDs.length > 0) message += `Failed for UID(s): ${failedUIDs.join(', ')}.`;

        const logStatus = failedUIDs.length === 0 ? 'Success' : 'Partial Failure';
        const logDetails = `Event: ${eventName}, Points: ${points}, Success UIDs: ${successUIDs.join(',') || 'None'}, Failed UIDs: ${failedUIDs.join(',') || 'None'}`;
        logAction(adminUsername, 'Added Event Points (Bulk)', ipAddress, `${logStatus} - ${logDetails}`);

        res.json({ success: failedUIDs.length === 0, message: message.trim() || "No valid UIDs provided." });

    } catch (error) {
        if (connection) connection.release();
        overallError = error;
        logger.error(`Bulk Event Points Main Error by ${adminUsername}, IP: ${ipAddress}: ${error.message}`);
        logAction(adminUsername, 'Attempted Add Event Points (Bulk)', ipAddress, `Failed - Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Server error during bulk points add.' });
    }
});

// Mark Attendance (Single)
app.post('/api/attendance', requireLogin, async (req, res) => {
    const { uid, day } = req.body;
    const adminUsername = req.session.username;
    const ipAddress = req.ip;
    const points = 100;
    const reason = `Attendance Day ${day}`;
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT uid FROM candidates WHERE uid = ?', [uid]);
        if (rows.length === 0) {
            connection.release();
            logAction(adminUsername, 'Attempted Mark Attendance', ipAddress, `Failed - UID ${uid} not found`);
            return res.status(404).json({ success: false, message: `Candidate UID ${uid} not found.` });
        }
        await connection.beginTransaction();
        await connection.execute(
            'INSERT INTO points_log (candidate_uid, points, reason, admin_username) VALUES (?, ?, ?, ?)',
            [uid, points, reason, adminUsername]
        );
        await connection.execute(
            'INSERT INTO attendance (candidate_uid, event_day, attended_at) VALUES (?, ?, CURDATE())',
            [uid, day]
        );
        await connection.commit();
        connection.release();
        logAction(adminUsername, 'Marked Attendance', ipAddress, `UID: ${uid}, Day: ${day}`);
        res.json({ success: true, message: `Attendance marked for Day ${day}.` });
    } catch (error) {
        if (connection) { await connection.rollback(); connection.release(); }
        logger.error(`Mark Attendance Error by ${adminUsername}, IP: ${ipAddress}: ${error.message}`);
        logAction(adminUsername, 'Attempted Mark Attendance', ipAddress, `Failed - UID: ${uid}, Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark attendance.' });
    }
});

// Mark Bulk Attendance
app.post('/api/attendance/bulk', requireLogin, async (req, res) => {
    const { uids, day } = req.body;
    const adminUsername = req.session.username;
    const ipAddress = req.ip;
    const uidArray = [...new Set(uids.split(/[\s,;]+/))].filter(uid => uid.trim() !== '' && !isNaN(uid.trim()));
    const points = 100;
    const reason = `Attendance Day ${day}`;
    let successUIDs = [];
    let failedUIDs = [];
    let overallError = null;

    for (const uid of uidArray) {
        const trimmedUid = uid.trim();
        // Skip validation, already filtered

        let connection;
        try {
            connection = await pool.getConnection();
            const [rows] = await connection.execute('SELECT uid FROM candidates WHERE uid = ?', [trimmedUid]);
            if (rows.length === 0) {
                failedUIDs.push(trimmedUid);
                connection.release();
                continue;
            }
            await connection.beginTransaction();
            await connection.execute(
                'INSERT INTO points_log (candidate_uid, points, reason, admin_username) VALUES (?, ?, ?, ?)',
                [trimmedUid, points, reason, adminUsername]
            );
            await connection.execute(
                'INSERT INTO attendance (candidate_uid, event_day, attended_at) VALUES (?, ?, CURDATE())',
                 [trimmedUid, day]
            );
            await connection.commit();
            successUIDs.push(trimmedUid);
        } catch (error) {
            if (connection) await connection.rollback();
            failedUIDs.push(trimmedUid);
            logger.error(`Bulk Attendance Error for UID ${trimmedUid} by ${adminUsername}, IP: ${ipAddress}: ${error.message}`);
            overallError = error; // Track if any individual transaction failed
        } finally {
            if (connection) connection.release();
        }
    }

    let message = '';
    if (successUIDs.length > 0) message += `Attendance marked for ${successUIDs.length} user(s). `;
    if (failedUIDs.length > 0) message += `Failed for UID(s): ${failedUIDs.join(', ')}.`;

    const logStatus = failedUIDs.length === 0 ? 'Success' : 'Partial Failure';
    const logDetails = `Day: ${day}, Success UIDs: ${successUIDs.join(',') || 'None'}, Failed UIDs: ${failedUIDs.join(',') || 'None'}`;
    logAction(adminUsername, 'Marked Bulk Attendance', ipAddress, `${logStatus} - ${logDetails}`);

    res.json({ success: failedUIDs.length === 0, message: message.trim() || "No valid UIDs provided." });
});

// Delete a Candidate
app.delete('/api/candidates/:uid', requireLogin, async (req, res) => {
    const { uid } = req.params;
    const username = req.session.username;
    const ipAddress = req.ip;
    let connection;
    try {
        connection = await pool.getConnection();
        const [deleteResult] = await connection.execute('DELETE FROM candidates WHERE uid = ?', [uid]);
        connection.release();
        if (deleteResult.affectedRows > 0) {
            logAction(username, 'Deleted Candidate', ipAddress, `UID: ${uid}`);
            res.json({ success: true, message: `Candidate ${uid} deleted successfully.` });
        } else {
             logger.warn(`Delete Failed by ${username}, IP: ${ipAddress}: Candidate UID ${uid} not found.`);
             logAction(username, 'Attempted Delete Candidate', ipAddress, `Failed - UID ${uid} not found`);
             res.status(404).json({ success: false, message: `Candidate UID ${uid} not found.` });
        }
    } catch (error) {
        if (connection) connection.release();
        logger.error(`Delete Candidate Error by ${username}, IP: ${ipAddress}: ${error.message}`);
        logAction(username, 'Attempted Delete Candidate', ipAddress, `Failed - UID: ${uid}, Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to delete candidate.' });
    }
});

// --- Serve Login Page ---
// Serve login.html if requested directly, or redirect if already logged in
app.get('/Login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Serve Dashboard Page (Protected) ---
// Catch-all route requires login. Serves index.html for valid routes.
app.get('*', requireLogin, (req, res) => {
    // Basic check to avoid serving index.html for file requests
    if (path.extname(req.path).length > 0 && req.path !== '/') {
        logger.warn(`Resource not found: ${req.path} from IP: ${req.ip}`);
        return res.status(404).send('Not found');
    }
    // Serve the main application page
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running! Access your app at http://localhost:${PORT}\n\n`);
    logger.info(`Server started on port ${PORT}`);
});
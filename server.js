const express = require('express');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');
const cookieSession = require('cookie-session');
const Database = require('better-sqlite3');
const multer = require('multer');

const app = express();
const PORT = 3000;

// Initialize SQLite database file local connection
const db = new Database('portfolio.db');

// Create database tables if they do not exist yet
// Initialize separate, robust independent database table build queries
db.prepare("CREATE TABLE IF NOT EXISTS about (id INTEGER PRIMARY KEY, content TEXT)").run();
db.prepare("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, title TEXT, desc TEXT, link TEXT, img TEXT)").run();
db.prepare("CREATE TABLE IF NOT EXISTS articles (slug TEXT PRIMARY KEY, title TEXT, markdown TEXT, thumbnail TEXT)").run();
db.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, message TEXT, date TEXT)").run();


// Insert default baseline text content if tables are empty
const aboutCheck = db.prepare("SELECT COUNT(*) as count FROM about").get();
if (aboutCheck.count === 0) {
    db.prepare("INSERT INTO about (content) VALUES (?)").run("# Hello, I am Olansile 👋\nWelcome to my portfolio.");
}

const projectCheck = db.prepare("SELECT COUNT(*) as count FROM projects").get();
if (projectCheck.count === 0) {
    db.prepare("INSERT INTO projects (title, desc, link, img) VALUES (?, ?, ?, ?)").run('E-Commerce Layer', 'Node.js payment processing hooks.', '#', 'https://unsplash.com');
    db.prepare("INSERT INTO projects (title, desc, link, img) VALUES (?, ?, ?, ?)").run('Event Streamer', 'Asynchronous systems logging dashboard.', '#', 'https://unsplash.com');
    db.prepare("INSERT INTO projects (title, desc, link, img) VALUES (?, ?, ?, ?)").run('Markdown CMS Engine', 'File structure text streaming tools.', '#', 'https://unsplash.com');
}

// Setup static file uploads storage logic parameters
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

app.use(cookieSession({
    name: 'session',
    keys: ['olansile-secure-token-2026'],
    maxAge: 24 * 60 * 60 * 1000
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = "admin1234";

// HOMEPAGE ROUTE
app.get('/', (req, res) => {
    const aboutRow = db.prepare("SELECT content FROM about WHERE id = 1").get();
    const aboutHtml = marked(aboutRow.content);
    const projectsList = db.prepare("SELECT * FROM projects").all();
    const articlesList = db.prepare("SELECT slug, title, thumbnail FROM articles").all();

    res.render('index', { 
        title: "Olansile | Portfolio", 
        about: aboutHtml, 
        projects: projectsList, 
        articles: articlesList 
    });
});

// SINGLE ARTICLE PATHWAY
app.get('/articles/:slug', (req, res) => {
    const article = db.prepare("SELECT * FROM articles WHERE slug = ?").get(req.params.slug);
    if (article) {
        const htmlBody = marked(article.markdown);
        res.render('article', { title: article.title, content: htmlBody, thumbnail: article.thumbnail });
    } else {
        res.status(404).send("<h1>Article Not Found</h1><a href='/'>Return Home</a>");
    }
});

// LOGIN PORTAL MANAGEMENT
app.get('/admin', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/admin/dashboard');
    res.render('admin-login');
});

app.post('/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.isLoggedIn = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin-login', { error: "Authentication credentials failed." });
    }
});

// PROTECTED CMS DASHBOARD FORM RENDER
// PROTECTED CMS DASHBOARD FORM RENDER - FIXED ARTICLE SYNC
app.get('/admin/dashboard', (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/admin');
    
    // 1. Fetch about info
    const aboutRow = db.prepare("SELECT content FROM about WHERE id = 1").get();
    
    // 2. Fetch all project card elements
    const projectsList = db.prepare("SELECT * FROM projects").all();
    
    // 3. FORCE FETCH ALL ARTICLES (Retrieves both columns needed for management)
    const articlesList = db.prepare("SELECT slug, title FROM articles").all();
    
    // Render view passing all arrays cleanly
    res.render('admin-dashboard', { 
        aboutText: aboutRow.content, 
        projects: projectsList, 
        articles: articlesList 
    });
});


// UPDATE BIO ENDPOINT
app.post('/admin/update-about', (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).send('Unauthorized');
    db.prepare("UPDATE about SET content = ? WHERE id = 1").run(req.body.aboutContent);
    res.redirect('/');
});

// UPDATE SPECIFIC PROJECTS CARDS DATA ENDPOINT
app.post('/admin/update-project/:id', upload.single('projectImg'), (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).send('Unauthorized');
    const { title, desc, link } = req.body;
    if (req.file) {
        const imgPath = '/uploads/' + req.file.filename;
        db.prepare("UPDATE projects SET title = ?, desc = ?, link = ?, img = ? WHERE id = ?").run(title, desc, link, imgPath, req.params.id);
    } else {
        db.prepare("UPDATE projects SET title = ?, desc = ?, link = ? WHERE id = ?").run(title, desc, link, req.params.id);
    }
    res.redirect('/admin/dashboard');
});

// PUBLISH NEW ARTICLE WITH THUMBNAIL PHOTO
app.post('/admin/create-article', upload.single('thumbnail'), (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).send('Unauthorized');
    const { slug, title, markdown } = req.body;
    const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const thumbnailPath = req.file ? '/uploads/' + req.file.filename : '/uploads/default-blog.jpg';
    
    db.prepare("INSERT OR REPLACE INTO articles (slug, title, markdown, thumbnail) VALUES (?, ?, ?, ?)").run(safeSlug, title, markdown, thumbnailPath);
    res.redirect('/');
});

// LOGOUT ROUTE
app.get('/admin/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

const nodemailer = require('nodemailer'); // Import the mail package near the top of your route logic blocks

// ROUTE: Handle Incoming Contact Form Submissions with SQLite Logging & SMTP Email Delivery
app.post('/contact/send', async (req, res) => {
    const { name, email, message } = req.body;
    const currentDate = new Date().toISOString().split('T')[0];

    try {
        // 1. Back up data entry logs securely inside your local relational SQLite file
        db.prepare("INSERT INTO messages (name, email, message, date) VALUES (?, ?, ?, ?)")
          .run(name, email, message, currentDate);

        // 2. Configure cPanel SMTP Node Transport Parameters
        // NOTE: Replace 'your-cpanel-password' below with the actual password token you generated inside cPanel for info@olansile.name.ng
        const transporter = nodemailer.createTransport({
            host: 'mail.olansile.name.ng', // Your standard cPanel outgoing mail server host string
            port: 465,                     // Secure SSL port layout definition
            secure: true,                  // High security true verification layer
            auth: {
                user: 'info@olansile.name.ng',
                pass: 'your-cpanel-password' 
            }
        });

        // 3. Construct and Format the Email Notification Package Layout
        const mailOptions = {
            from: '"Portfolio Lead System" <info@olansile.name.ng>',
            to: 'info@olansile.name.ng', 
            replyTo: email, // Allows you to click 'Reply' inside your mail client to email the visitor back directly!
            subject: `💼 New Client Outreach from ${name}`,
            text: `You received a new inquiry from your website portfolio contact form.\n\n` +
                  `Sender Name: ${name}\n` +
                  `Sender Email: ${email}\n` +
                  `Date: ${currentDate}\n\n` +
                  `Message:\n${message}`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333; background: #f9f9f9; border-radius: 8px;">
                    <h2 style="color: #0284c7; margin-top: 0;">New Contact Form Submission</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Date:</strong> ${currentDate}</p>
                    <hr style="border: 0; border-top: 1px solid #ddd; margin: 20px 0;">
                    <p><strong>Message:</strong></p>
                    <blockquote style="background: #fff; padding: 15px; border-left: 4px solid #38bdf8; margin: 0; border-radius: 4px;">
                        ${message.replace(/\n/g, '<br>')}
                    </blockquote>
                </div>
            `
        };

        // 4. Asynchronously Fire Mail Payload Outward
        await transporter.sendMail(mailOptions);
        console.log(`✉️ Email notification successfully pushed to info@olansile.name.ng`);

    } catch (error) {
        // Log errors locally to console loop systems but prevent crashing page workflows
        console.error("❌ Notification Delivery Pipeline Interrupted:", error);
    }

    // 5. Re-render Layout Passing Success Display Flags Smoothly
    const aboutRow = db.prepare("SELECT content FROM about WHERE id = 1").get();
    const aboutHtml = marked(aboutRow.content);
    const projectsList = db.prepare("SELECT * FROM projects").all();
    const articlesList = db.prepare("SELECT slug, title, thumbnail FROM articles").all();

    res.render('index', { 
        title: "Olansile | Portfolio", 
        about: aboutHtml, 
        projects: projectsList, 
        articles: articlesList,
        successMsg: true 
    });
});

// ROUTE: Delete an Article from SQLite and Sync UI
app.post('/admin/delete-article/:slug', (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).send('Unauthorized');
    
    // Delete the article matching the precise URL identifier slug
    db.prepare("DELETE FROM articles WHERE slug = ?").run(req.params.slug);
    res.redirect('/admin/dashboard');
});

// ROUTE: Delete a Featured Project Card Entry
app.post('/admin/delete-project/:id', (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).send('Unauthorized');
    
    // Delete the specific project card matching its database row ID
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    res.redirect('/admin/dashboard');
});


app.listen(PORT, () => console.log(`🚀 Portfolio Engine Live on http://localhost:${PORT}`));

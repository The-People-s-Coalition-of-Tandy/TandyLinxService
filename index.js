import express from "express";
import nunjucks from "nunjucks";
import Database from "better-sqlite3";
import path, {
    dirname
} from "path";
import fs from "fs";
import {
    fileURLToPath
} from "url";
import session from 'express-session';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();


const db = new Database("./tandylinx.db", {
    fileMustExist: true
});
const app = express();

// ES Module fix for __dirname
const __filename = fileURLToPath(
    import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({
    extended: true
}));

app.set("view engine", "html");

app.use(session({
    secret: process.env.SECRET_KEY, // Change this to a random secret string
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: 'auto',
        httpOnly: true,
    }
}));

// Nunjucks configuration
nunjucks.configure("./templates", {
    autoescape: true,
    express: app,
});

function checkAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login'); // Redirect to login if not authenticated
}

app.get("/", (req, res) => {
    res.render("index.html");
})

app.get("/profile", checkAuthenticated, (req, res) => {
    const userId = req.session.userId;
    const query = db.prepare("SELECT username FROM users WHERE id = ?");
    const user = query.get(userId);

    const stmt = db.prepare("SELECT pageTitle, pageURL FROM links WHERE userId = ?");
    const pages = stmt.all(userId);

    res.render("profile.html", {
        username: user.username,
        pages
    });
})



app.get('/register', (req, res) => {
    res.render('register.html');
});

app.post('/register', async (req, res) => {
    const {
        username,
        password
    } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10); // Hash the password

    try {
        const insert = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
        insert.run(username, hashedPassword);
        res.redirect('/login'); // Redirect to login page after registration
    } catch (error) {
        console.error(error.message);
        res.redirect('/register?error=User already exists or other error.');
    }
});

app.get('/login', (req, res) => {
    const {
        error
    } = req.query;

    if (req.session.userId) {
        return res.redirect('/profile');
    }

    res.render('login.html', {
        errorMessage: error
    });
});

app.post('/login', (req, res) => {
    const {
        username,
        password
    } = req.body;
    const query = db.prepare("SELECT * FROM users WHERE username = ?");
    const user = query.get(username);

    if (user && bcrypt.compareSync(password, user.password)) {
        // Passwords match
        req.session.userId = user.id; // Save the user id in the session
        res.redirect('/profile'); // Redirect to the home page or dashboard
    } else {
        res.redirect('/login?error=Invalid username or password');
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => { // Destroy the session
        res.redirect('/login'); // Redirect to login page
    });
});

app.get("/checkpageURL", (req, res) => {
    const pageURL = req.query.name;
    const checkStmt = db.prepare(
        "SELECT EXISTS(SELECT 1 FROM links WHERE pageURL = ?) AS exist"
    );
    console.log(pageURL);
    const exist = checkStmt.get(pageURL).exist;

    res.json({
        exists: !!exist
    });
});

app.get("/checkUsername", (req, res) => {
    const username = req.query.name;
    const checkStmt = db.prepare(
        "SELECT EXISTS(SELECT 1 FROM users WHERE username = ?) AS exist"
    );
    console.log(username);
    const exist = checkStmt.get(username).exist;

    res.json({
        exists: !!exist
    });
});
app.get("/create", (req, res) => {
    // Extract query parameters if any
    const {
        error,
        pageURL,
        links
    } = req.query;

    const stylesPath = path.join(__dirname, 'styles.json');
    const styles = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));

    // If there are links, parse them back into an array
    let linksArray = [];
    if (links) {
        try {
            linksArray = JSON.parse(links);
        } catch (parseError) {
            console.error(parseError);
        }
    }

    res.render("create.html", {
        errorMessage: error,
        pageURL: pageURL || "",
        links: linksArray,
        styles,
    });
});
app.post("/create", (req, res) => {
    const {
        pageURL,
        pageTitle,
        linkNames,
        linkURLs,
        style
    } = req.body;

    // Combine link names and URLs into an array of objects
    const links = linkNames.map((name, index) => {
        return { name: name, url: linkURLs[index] };
    });
    const linksJSON = JSON.stringify(links);

    const userId = req.session.userId; // Assuming this is set during login

    // Ensure the user is logged in
    if (!userId) {
        return res.redirect('/login');
    }

    const checkStmt = db.prepare("SELECT EXISTS(SELECT 1 FROM links WHERE pageURL = ?) AS exist");
    const exist = checkStmt.get(pageURL).exist;

    if (exist) {
        return res.redirect('/create?error=Page name already exists. Please choose a different name.');
    } else {
        try {
            const insertStmt = db.prepare("INSERT INTO links (pageURL, pageTitle, links, style, userId) VALUES (?, ?, ?, ?, ?)");
            insertStmt.run(pageURL, pageTitle, linksJSON, style, userId);
            res.redirect(`/${pageURL}`);
        } catch (err) {
            console.error(err.message);
            res.status(500).send("Failed to create the TandyLinx page.");
        }
    }
});


app.get("/:pageURL", (req, res) => {
    try {
        const stmt = db.prepare("SELECT links, style, pageTitle FROM links WHERE pageURL = ?");
        const row = stmt.get(req.params.pageURL);
        if (row) {
            console.log(row);
            const links = JSON.parse(row.links); // Parse the JSON string back into an array
            res.render(row.style, {
                links,
                pageTitle: row.pageTitle
            });
        } else {
            res.status(404).send("Page not found");
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Failed to retrieve the TandyLinx page.");
    }
});

app.get("/edit/:pageURL", checkAuthenticated, (req, res) => {
    const pageURL = req.params.pageURL;
    const userId = req.session.userId;

    const stylesPath = path.join(__dirname, 'styles.json');
    const styles = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));

    try {
        const stmt = db.prepare("SELECT * FROM links WHERE pageURL = ? AND userId = ?");
        const pageData = stmt.get(pageURL, userId);

        if (pageData) {
            const links = JSON.parse(pageData.links); // Assuming links are stored as a JSON string
            res.render("editPage", {
                pageURL: pageData.pageURL,
                pageTitle: pageData.pageTitle,
                links: links,
                style: pageData.style,
                styles: styles
            });
        } else {
            res.status(404).send("Page not found or you do not have permission to edit it.");
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Failed to retrieve the TandyLinx page for editing.");
    }
});

app.post("/update/:pageURL", checkAuthenticated, (req, res) => {
    const originalpageURL = req.params.pageURL;
    const { linkNames, linkURLs, style, pageURL, pageTitle } = req.body;
    const userId = req.session.userId; // Verify this is the owner of the link page

    // Combine link names and URLs into an array of objects
    const links = linkNames.map((name, index) => ({
        name: name,
        url: linkURLs[index]
    }));

    if(pageURL !== originalpageURL) { 
        const checkStmt = db.prepare("SELECT EXISTS(SELECT 1 FROM links WHERE pageURL = ?) AS exist");
        const exist = checkStmt.get(pageURL).exist;

        if (exist) {
            return res.redirect(`/edit/${originalpageURL}?error=Page name already exists. Please choose a different name.`);
        }
    }

    try {
        const updateStmt = db.prepare("UPDATE links SET links = ?, style = ?, pageTitle = ?, pageURL = ? WHERE pageURL = ? AND userId = ?");
        updateStmt.run(JSON.stringify(links), style, pageTitle, pageURL, originalpageURL, userId);
        
        res.redirect("/profile"); // Redirect to the profile page or the updated page itself
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Failed to update the TandyLinx page.");
    }
});


app.listen(PORT, () => {
    console.log(`Example app listening at http://localhost:${PORT}`);
});
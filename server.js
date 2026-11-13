const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const cliPort = parseInt(process.argv, 10);
const PORT = (!isNaN(cliPort) && cliPort > 0 && cliPort <= 65535)
    ? cliPort
    : (process.env.PORT || 8080);

const STORE_FILE = path.join(__dirname, 'encrypted_history.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_HISTORY = 100;

let encryptedHistory = [];
try {
    if (fs.existsSync(STORE_FILE)) {
        encryptedHistory = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
} catch (err) {
    encryptedHistory = [];
}

let saveTimeout = null;
function scheduleHistorySave() {
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        fs.writeFile(STORE_FILE, JSON.stringify(encryptedHistory), 'utf8', (err) => {
            if (err) console.error('Failed to persist encrypted history:', err.message);
        });
    }, 1000);
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript'
};

const server = http.createServer((req, res) => {
    // Health check endpoint for Render & UptimeRobot
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    const safeUrl = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(PUBLIC_DIR, path.normalize(safeUrl));

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
            res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Replay stored encrypted packets so offline messages are delivered immediately
    encryptedHistory.forEach((entry) => {
        if (ws.readyState === 1) {
            const buf = Buffer.from(entry.payload, 'base64');
            ws.send(buf, { binary: true });
        }
    });

    ws.on('message', (data, isBinary) => {
        if (!isBinary) return;

        const buf = Buffer.from(data);
        // Ignore 1-byte client keep-alive heartbeats
        if (buf.length === 1 && buf === 0x00) {
            return;
        }

        encryptedHistory.push({
            id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            payload: buf.toString('base64')
        });

        if (encryptedHistory.length > MAX_HISTORY) {
            encryptedHistory = encryptedHistory.slice(-MAX_HISTORY);
        }
        scheduleHistorySave();

        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(data, { binary: true });
            }
        });
    });
});

// Keep-alive ping every 30 seconds so active tabs stay connected
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Encrypted Web Chat running at http://localhost:${PORT}`);
});

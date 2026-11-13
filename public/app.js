import { encryptMessage, decryptMessage } from './crypto.js';
import {
    savePacketToLocal,
    loadLocalHistory,
    wipeLocalHistory,
    downloadChatLog,
    saveDraft,
    loadDraft,
    clearDraft,
    toggleAutoDownload
} from './storage.js';

let ws;
let currentName = "";
let password = "";

const replayedSignatures = new Set();
const sessionTranscript = [];
const outgoingQueue = [];
let flushTimer = null;

function getTimestamp() {
    return new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function appendLog(lineText, isSystem = false, isReplay = false) {
    // Only deduplicate replayed messages (from localStorage / server history), never live messages
    if (isReplay) {
        if (replayedSignatures.has(lineText)) return;
        replayedSignatures.add(lineText);
    }

    const box = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = isSystem ? 'msg sys' : 'msg';

    // Matches [HH:MM] or [HH:MM:SS] with optional AM/PM
    const hasEmbeddedTime = /^\[\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?\]/i.test(lineText);
    const fullLine = hasEmbeddedTime ? lineText : `[${getTimestamp()}] ${lineText}`;

    if (hasEmbeddedTime) {
        const closingBracket = lineText.indexOf(']');
        const timePart = lineText.slice(0, closingBracket + 1);
        const restPart = lineText.slice(closingBracket + 1);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'time';
        timeSpan.textContent = timePart;
        div.appendChild(timeSpan);
        div.appendChild(document.createTextNode(restPart));
    } else {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'time';
        timeSpan.textContent = `[${getTimestamp()}]`;
        div.appendChild(timeSpan);
        div.appendChild(document.createTextNode(lineText));
    }

    sessionTranscript.push(fullLine);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function enqueueSend(encryptedBuffer) {
    outgoingQueue.push(encryptedBuffer);
    drainQueue();
}

function drainQueue() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    while (outgoingQueue.length > 0) {
        if (ws.bufferedAmount > 65536) {
            if (!flushTimer) {
                flushTimer = setTimeout(() => {
                    flushTimer = null;
                    drainQueue();
                }, 50);
            }
            return;
        }
        const packet = outgoingQueue.shift();
        ws.send(packet);
    }
}

function joinChat() {
    currentName = document.getElementById('username').value.trim();
    password = document.getElementById('passphrase').value;
    const customAddr = document.getElementById('serverAddr').value.trim();

    if (!currentName || !password) {
        alert("Name and passphrase are required.");
        return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const targetHost = customAddr || location.host;

    if (!targetHost) {
        alert("Please enter a Server Host:Port (e.g., localhost:8080).");
        return;
    }

    ws = new WebSocket(`${protocol}//${targetHost}`);
    ws.binaryType = 'arraybuffer';

    let initialSyncDone = false;

    ws.onopen = () => {
        document.getElementById('setup').style.display = 'none';
        document.getElementById('chat').style.display = 'flex';
        document.getElementById('room-info').textContent = `Connected: ${targetHost}`;

        const history = loadLocalHistory(password);
        history.forEach((plain) => appendLog(plain, plain.includes('[System]'), true));

        document.getElementById('msgInput').value = loadDraft();

        appendLog(`--- Joined as ${currentName}! Type /help for commands ---`, true, false);
        const joinNotice = `[${getTimestamp()}] [System] ${currentName} joined the room.`;
        enqueueSend(encryptMessage(joinNotice, password));

        setTimeout(() => { initialSyncDone = true; }, 500);
        drainQueue();
    };

    ws.onmessage = (event) => {
        const plain = decryptMessage(event.data, password);
        appendLog(plain, plain.includes('[System]'), !initialSyncDone);
        savePacketToLocal(event.data, sessionTranscript);
    };

    ws.onerror = () => {
        appendLog("[System] Connection error. Check server address and port.", true, false);
    };

    ws.onclose = () => {
        appendLog("[System] Disconnected from server.", true, false);
    };
}

function handleSend(e) {
    e.preventDefault();
    const inputEl = document.getElementById('msgInput');
    const userMsg = inputEl.value.trim();
    inputEl.value = '';
    clearDraft();

    if (!userMsg) return;

    if (userMsg === '/help') {
        appendLog("Commands: /help, /save, /autosave, /wipe, /nick <newname>, /clear", true, false);
        return;
    }
    if (userMsg === '/clear') {
        document.getElementById('messages').innerHTML = '';
        return;
    }
    if (userMsg === '/save') {
        const saved = downloadChatLog(sessionTranscript);
        appendLog(saved ? "[System] Chat log downloaded." : "[System] No messages to save yet.", true, false);
        return;
    }
    if (userMsg === '/autosave') {
        const state = toggleAutoDownload();
        appendLog(
            `[System] Auto-download backup is now ${state ? 'ON (triggers every 200 messages)' : 'OFF'}.`,
            true,
            false
        );
        return;
    }
    if (userMsg === '/wipe') {
        wipeLocalHistory();
        replayedSignatures.clear();
        appendLog("[System] Local browser chat history wiped.", true, false);
        return;
    }
    if (userMsg.startsWith('/nick ') && userMsg.length > 6) {
        const oldName = currentName;
        currentName = userMsg.slice(6).trim();
        const notice = `[${getTimestamp()}] [System] ${oldName} is now known as ${currentName}.`;
        const encNotice = encryptMessage(notice, password);
        appendLog(notice, true, false);
        savePacketToLocal(encNotice, sessionTranscript);
        enqueueSend(encNotice);
        return;
    }

    const formatted = `[${getTimestamp()}] [${currentName}]: ${userMsg}`;
    const encrypted = encryptMessage(formatted, password);
    appendLog(formatted, false, false);
    savePacketToLocal(encrypted, sessionTranscript);
    enqueueSend(encrypted);
}

// Wire up DOM event listeners
document.getElementById('joinBtn').addEventListener('click', joinChat);
document.getElementById('input-row').addEventListener('submit', handleSend);
document.getElementById('msgInput').addEventListener('input', (e) => saveDraft(e.target.value));

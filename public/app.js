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
let targetHost = "";
let hasConnectedOnce = false;
let manualDisconnect = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let reconnectAttempts = 0;
let msgSequence = 0;

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

function setConnectionStatus(text, isConnected = true) {
    const infoEl = document.getElementById('room-info');
    if (!infoEl) return;
    infoEl.textContent = text;
    infoEl.style.color = isConnected ? '#81c784' : '#ffb74d';
}

function appendLog(lineText, isSystem = false) {
    const box = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = isSystem ? 'msg sys' : 'msg';

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

function startHeartbeat() {
    stopHeartbeat();
    const pingFrame = new Uint8Array([0x00]).buffer;

    heartbeatTimer = setInterval(() => {
        if (!ws) return;
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(pingFrame);
            } catch (e) {
                forceReconnect();
            }
        } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            forceReconnect();
        }
    }, 15000);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function scheduleReconnect() {
    if (manualDisconnect || reconnectTimer) return;

    reconnectAttempts++;
    const delay = Math.min(1000 * reconnectAttempts, 8000);
    setConnectionStatus(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`, false);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
    }, delay);
}

function forceReconnect() {
    stopHeartbeat();
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        try {
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
        } catch (e) { }
    }
    connectWebSocket();
}

function connectWebSocket() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    setConnectionStatus("Connecting...", false);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${targetHost}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        const wasDisconnected = hasConnectedOnce && reconnectAttempts > 0;
        reconnectAttempts = 0;
        setConnectionStatus(`● Connected: ${targetHost}`, true);
        startHeartbeat();

        if (!hasConnectedOnce) {
            hasConnectedOnce = true;
            document.getElementById('setup').style.display = 'none';
            document.getElementById('chat').style.display = 'flex';

            const history = loadLocalHistory(password);
            history.forEach((plain) => appendLog(plain, plain.includes('[System]')));

            document.getElementById('msgInput').value = loadDraft();

            appendLog(`--- Joined as ${currentName}! Type /help for commands ---`, true);
            const joinNotice = `[${getTimestamp()}] [System] ${currentName} joined the room.`;
            enqueueSend(encryptMessage(joinNotice, password));
        } else if (wasDisconnected) {
            appendLog("[System] Reconnected to room.", true);
        }

        drainQueue();
    };

    ws.onmessage = (event) => {
        const isNewPacket = savePacketToLocal(event.data, sessionTranscript);
        if (!isNewPacket) return;

        const plain = decryptMessage(event.data, password);
        appendLog(plain, plain.includes('[System]'));
    };

    ws.onerror = () => {
        // Handled by onclose
    };

    ws.onclose = () => {
        stopHeartbeat();
        if (!manualDisconnect) {
            scheduleReconnect();
        }
    };
}

function joinChat() {
    currentName = document.getElementById('username').value.trim();
    password = document.getElementById('passphrase').value;
    const customAddr = document.getElementById('serverAddr').value.trim();

    if (!currentName || !password) {
        alert("Name and passphrase are required.");
        return;
    }

    targetHost = customAddr || location.host;
    if (!targetHost) {
        alert("Please enter a Server Host:Port (e.g., localhost:8080).");
        return;
    }

    manualDisconnect = false;
    connectWebSocket();
}

function handleSend(e) {
    e.preventDefault();
    const inputEl = document.getElementById('msgInput');
    const userMsg = inputEl.value.trim();
    inputEl.value = '';
    clearDraft();

    if (!userMsg) return;

    if (userMsg === '/help') {
        appendLog("Commands: /help, /reconnect, /save, /autosave, /wipe, /nick <newname>, /clear", true);
        return;
    }
    if (userMsg === '/reconnect') {
        appendLog("[System] Forcing reconnect...", true);
        forceReconnect();
        return;
    }
    if (userMsg === '/clear') {
        document.getElementById('messages').innerHTML = '';
        return;
    }
    if (userMsg === '/save') {
        const saved = downloadChatLog(sessionTranscript);
        appendLog(saved ? "[System] Chat log downloaded." : "[System] No messages to save yet.", true);
        return;
    }
    if (userMsg === '/autosave') {
        const state = toggleAutoDownload();
        appendLog(
            `[System] Auto-download backup is now ${state ? 'ON (triggers every 200 messages)' : 'OFF'}.`,
            true
        );
        return;
    }
    if (userMsg === '/wipe') {
        wipeLocalHistory();
        appendLog("[System] Local browser chat history wiped.", true);
        return;
    }
    if (userMsg.startsWith('/nick ') && userMsg.length > 6) {
        const oldName = currentName;
        currentName = userMsg.slice(6).trim();
        const notice = `[${getTimestamp()}] [System] ${oldName} is now known as ${currentName}.`;
        const encNotice = encryptMessage(notice, password);
        appendLog(notice, true);
        savePacketToLocal(encNotice, sessionTranscript);
        enqueueSend(encNotice);
        return;
    }

    msgSequence = (msgSequence + 1) % 16;
    const uniqueSuffix = "\u200B".repeat(msgSequence);
    const formatted = `[${getTimestamp()}] [${currentName}]: ${userMsg}${uniqueSuffix}`;

    const encrypted = encryptMessage(formatted, password);
    appendLog(formatted, false);
    savePacketToLocal(encrypted, sessionTranscript);
    enqueueSend(encrypted);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        forceReconnect();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasConnectedOnce && !manualDisconnect) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            forceReconnect();
        }
    }
});

window.addEventListener('online', () => {
    if (hasConnectedOnce && !manualDisconnect) {
        forceReconnect();
    }
});

document.getElementById('joinBtn').addEventListener('click', joinChat);
document.getElementById('input-row').addEventListener('submit', handleSend);
document.getElementById('msgInput').addEventListener('input', (e) => saveDraft(e.target.value));

import { bufferToBase64, base64ToBuffer, decryptMessage } from './crypto.js';

const STORAGE_KEY = "xor_encrypted_chat_logs_v1";
const DRAFT_KEY = "xor_chat_unsent_draft_v1";
const AUTO_SAVE_INTERVAL = 200;

let autoDownloadEnabled = false;
let unsavedCount = 0;

export function flashSaveStatus(label = "● Autosaved") {
    const badge = document.getElementById('save-status');
    if (!badge) return;
    badge.textContent = "Saving...";
    badge.style.color = "#ffb74d";
    setTimeout(() => {
        badge.textContent = autoDownloadEnabled
            ? `${label} (${unsavedCount}/${AUTO_SAVE_INTERVAL})`
            : label;
        badge.style.color = "#81c784";
    }, 400);
}

export function saveDraft(text) {
    localStorage.setItem(DRAFT_KEY, text);
}

export function loadDraft() {
    return localStorage.getItem(DRAFT_KEY) || "";
}

export function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

export function toggleAutoDownload() {
    autoDownloadEnabled = !autoDownloadEnabled;
    if (autoDownloadEnabled) {
        unsavedCount = 0;
    }
    flashSaveStatus();
    return autoDownloadEnabled;
}

// Returns true if this exact encrypted packet is new, or false if already saved
export function savePacketToLocal(buffer, sessionTranscript) {
    try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        const b64 = bufferToBase64(buffer);

        if (existing.includes(b64)) {
            return false;
        }

        existing.push(b64);
        if (existing.length > 500) existing.shift();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

        if (autoDownloadEnabled) {
            unsavedCount++;
            if (unsavedCount >= AUTO_SAVE_INTERVAL) {
                unsavedCount = 0;
                downloadChatLog(sessionTranscript);
            }
        }
        flashSaveStatus();
        return true;
    } catch (e) {
        console.warn("localStorage unavailable:", e);
        return true;
    }
}

export function loadLocalHistory(password) {
    const messages = [];
    try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        existing.forEach((b64) => {
            const buf = base64ToBuffer(b64);
            messages.push(decryptMessage(buf, password));
        });
    } catch (e) {
        console.warn("Failed to restore localStorage logs:", e);
    }
    return messages;
}

export function wipeLocalHistory() {
    localStorage.removeItem(STORAGE_KEY);
}

export function downloadChatLog(sessionTranscript) {
    if (sessionTranscript.length === 0) return false;

    const blob = new Blob([sessionTranscript.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestampTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `chat_log_${timestampTag}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
}

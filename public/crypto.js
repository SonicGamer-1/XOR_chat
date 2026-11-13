const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encryptMessage(plainText, pass) {
    const textBytes = encoder.encode(plainText);
    const passBytes = encoder.encode(pass);
    const buffer = new ArrayBuffer(textBytes.length * 4);
    const view = new DataView(buffer);

    for (let i = 0; i < textBytes.length; i++) {
        const charVal = textBytes[i];
        const keyByte = passBytes[i % passBytes.length];
        const cipher = charVal ^ (keyByte + (i & 0xFF));
        view.setInt32(i * 4, cipher, false);
    }
    return buffer;
}

export function decryptMessage(buffer, pass) {
    const passBytes = encoder.encode(pass);
    const view = new DataView(buffer);
    const count = buffer.byteLength / 4;
    const outBytes = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        const cipher = view.getInt32(i * 4, false);
        const keyByte = passBytes[i % passBytes.length];
        outBytes[i] = cipher ^ (keyByte + (i & 0xFF));
    }
    return decoder.decode(outBytes);
}

export function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

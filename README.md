# XOR Encrypted Group Chat

A minimal browser-based group chat using a Node.js HTTP server and WebSockets. Messages are encoded in the browser with a rotating XOR scheme before they are sent to the server.

## Requirements

- Node.js 16 or newer
- npm

## Setup

Install the dependency:

```bash
npm install
```

## Run

Start the server on the default port (`8080`):

```bash
npm start
```

You can select a port with either a command-line argument or the `PORT` environment variable:

```bash
node server.js 9000
```

```bash
PORT=9000 node server.js
```

Open `http://localhost:8080` (or the selected port) in a browser. To connect from another device, use the computer's local network address in the **Server Host:Port** field.

## Using the chat

1. Enter a display name and shared room passphrase.
2. Leave **Server Host:Port** empty when the page is served by the chat server.
3. Use `/help`, `/nick <newname>`, or `/clear` in the message box.

All participants must use the same passphrase to read messages.

## Security note

The XOR encoding is intended for demonstration and does **not** provide modern cryptographic security. The server relays messages without authenticating users or validating rooms. Do not use this project for sensitive communications. For production use, replace the custom cipher with an authenticated encryption scheme and serve the application over HTTPS/WSS.

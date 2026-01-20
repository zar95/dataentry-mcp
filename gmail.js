import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import TurndownService from 'turndown';

// --- CONFIGURATION ---
const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, 'token.json');

// SCOPES for Gmail
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose'
];

/**
 * AUTHENTICATION LOGIC
 * Pulls credentials from Environment Variable "GOOGLE_CREDENTIALS_JSON" 
 * to avoid keeping secret files in GitHub.
 */
async function getAuthenticatedClient() {
  let credentials;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  } else {
    // Fallback for local testing
    const content = await fs.readFile(path.join(__dirname, 'credentials.json'));
    credentials = JSON.parse(content);
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  
  // NOTE: On Render, ensure your Google Cloud Console has your onrender.com URL in 'Redirect URIs'
  const rUri = process.env.REDIRECT_URI || redirect_uris[0];
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, rUri);

  try {
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    throw new Error("No token found. Please run the local auth script first to generate token.json.");
  }
}

// --- MCP SERVER SETUP ---
const server = new Server({ 
  name: "gmail-mcp-server-remote", 
  version: "1.6.0" 
}, { 
  capabilities: { tools: {} } 
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_emails",
      description: "Search emails using Gmail operators",
      inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number", default: 5 } } }
    },
    {
      name: "read_email",
      description: "Get full email body and attachment IDs",
      inputSchema: { type: "object", properties: { messageId: { type: "string" } }, required: ["messageId"] }
    },
    {
      name: "send_email",
      description: "Send a customized email. Supports plain text or HTML.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          isHtml: { type: "boolean", default: false }
        },
        required: ["to", "subject", "body"]
      }
    },
    {
        name: "get_attachment",
        description: "Retrieves and processes attachments (Excel, Word, Images, PDF)",
        inputSchema: {
          type: "object",
          properties: {
            messageId: { type: "string" },
            attachmentId: { type: "string" },
            mimeType: { type: "string" },
            filename: { type: "string" }
          },
          required: ["messageId", "attachmentId", "mimeType"]
        }
      }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_emails": {
        const res = await gmail.users.messages.list({ userId: 'me', q: args.query, maxResults: args.maxResults });
        return { content: [{ type: "text", text: JSON.stringify(res.data.messages || []) }] };
      }

      case "read_email": {
        const res = await gmail.users.messages.get({ userId: 'me', id: args.messageId });
        return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
      }

      case "send_email": {
        const { to, subject, body, isHtml } = args;
        const contentType = isHtml ? 'text/html' : 'text/plain';
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const message = [
          `To: ${to}`,
          `Content-Type: ${contentType}; charset=utf-8`,
          `MIME-Version: 1.0`,
          `Subject: ${utf8Subject}`,
          '',
          body
        ].join('\n');

        const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
        return { content: [{ type: "text", text: `Email sent. ID: ${res.data.id}` }] };
      }

      case "get_attachment": {
        const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId: args.messageId, id: args.attachmentId });
        const buffer = Buffer.from(res.data.data, 'base64url');
        let mimeType = args.mimeType.toLowerCase();

        if (mimeType.startsWith('image/')) {
          const png = await sharp(buffer).png().toBuffer();
          return { content: [{ type: "image", data: png.toString('base64'), mimeType: "image/png" }] };
        }
        if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
          const wb = XLSX.read(buffer, { type: 'buffer' });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          return { content: [{ type: "text", text: csv }] };
        }
        if (mimeType.includes('word')) {
            const { value } = await mammoth.convertToHtml({ buffer });
            const md = new TurndownService().turndown(value);
            return { content: [{ type: "text", text: md }] };
        }
        return { content: [{ type: "text", text: "File downloaded. Check raw data if needed." }] };
      }

      default: throw new Error(`Tool not found: ${name}`);
    }
  } catch (error) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
});

// --- SSE SESSION MANAGEMENT ---
const sessions = new Map();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  sessions.set(sessionId, transport);

  console.error(`[SSE] Connected: ${sessionId}`);
  res.on('close', () => {
    sessions.delete(sessionId);
    console.error(`[SSE] Disconnected: ${sessionId}`);
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sessions.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session expired.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.error(`MCP Server live at http://localhost:${PORT}`);
});
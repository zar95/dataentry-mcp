import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import open from 'open';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'];

async function getAuthenticatedClient() {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const credentials = JSON.parse(content);
  const { client_secret, client_id } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000');
  try {
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    return await getNewToken(oAuth2Client);
  }
}

async function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  console.error('\n--- GMAIL AUTH REQUIRED ---\n', authUrl, '\n');
  await open(authUrl);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost:3000');
        const code = url.searchParams.get('code');
        res.end('Auth Success!');
        server.close();
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        resolve(oAuth2Client);
      } catch (e) { reject(e); }
    }).listen(3000);
  });
}

const server = new Server({ name: "gmail-mcp-server", version: "1.3.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_emails",
      description: "Search emails (e.g., 'from:someone@gmail.com has:attachment')",
      inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number", default: 5 } } }
    },
    {
      name: "read_email",
      description: "Get full email body and attachment metadata",
      inputSchema: { type: "object", properties: { messageId: { type: "string" } }, required: ["messageId"] }
    },
    {
      name: "get_attachment",
      description: "Download attachment and return base64 data for AI analysis. Supports PNG, JPEG, PDF, Excel (.xlsx, .xls), and Word (.docx, .doc). IMPORTANT: The model (Claude or any) must use its own native capabilities to parse these files. Do not use external libraries.",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          attachmentId: { type: "string" },
          mimeType: { type: "string", description: "The type of file (e.g., image/png, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.wordprocessingml.document)" }
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
      case "get_attachment": {
        const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId: args.messageId, id: args.attachmentId });
        const base64Data = res.data.data.replace(/-/g, '+').replace(/_/g, '/'); // Fix URL-safe base64

        // Return base64 data as text - AI will analyze it
        return { content: [{ type: "text", text: `data:${args.mimeType};base64,${base64Data}` }] };
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gmail MCP Server active.");
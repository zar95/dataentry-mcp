import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import open from 'open';
import http from 'http';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import TurndownService from 'turndown';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
];

/**
 * AUTHENTICATION LOGIC
 */
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
        res.end('Auth Success! You can close this tab.');
        server.close();
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        resolve(oAuth2Client);
      } catch (e) { reject(e); }
    }).listen(3000);
  });
}

/**
 * MCP SERVER SETUP
 */
const server = new Server({ name: "gmail-mcp-server", version: "1.4.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_emails",
      description: "Search emails using Gmail operators (e.g., 'has:attachment filename:xlsx')",
      inputSchema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number", default: 5 } } }
    },
    {
      name: "read_email",
      description: "Get full email body and attachment IDs",
      inputSchema: { type: "object", properties: { messageId: { type: "string" } }, required: ["messageId"] }
    },
    {
      name: "get_attachment",
      description: "Retrieves attachment and converts it in-memory to an AI-readable format (Markdown/CSV/Image).",
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

      case "get_attachment": {
        const res = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: args.attachmentId
        });

        if (!res.data?.data) throw new Error("No attachment data found.");

        // Fix: Gmail uses base64url encoding
        const buffer = Buffer.from(res.data.data, 'base64url');
        console.error(`[get_attachment] Processing ${args.filename || 'file'} (${buffer.length} bytes)`);

        let mimeType = args.mimeType.toLowerCase();
        const filename = (args.filename || "").toLowerCase();

        // Improved Type Detection fallback
        if (mimeType === 'application/octet-stream' || !mimeType) {
          if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) mimeType = 'excel';
          else if (filename.endsWith('.docx') || filename.endsWith('.doc')) mimeType = 'word';
          else if (filename.endsWith('.pdf')) mimeType = 'application/pdf';
          else if (filename.match(/\.(jpg|jpeg|png|webp)$/)) mimeType = 'image/png';
        }

        // 1. Image Processing (Vision)
        if (mimeType.startsWith('image/')) {
          const pngBuffer = await sharp(buffer).png().toBuffer();
          return {
            content: [{ type: "image", data: pngBuffer.toString('base64'), mimeType: "image/png" }]
          };
        }

        // 2. Excel -> CSV (Data)
        if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'excel') {
          const wb = XLSX.read(buffer, { type: 'buffer' });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: false });
          return { content: [{ type: "text", text: `Sheet: ${wb.SheetNames[0]}\n\n${csv}` }] };
        }

        // 3. Word -> Markdown (Text)
        if (mimeType.includes('wordprocessingml') || mimeType.includes('msword') || mimeType === 'word') {
          const { value: html } = await mammoth.convertToHtml({ buffer });
          const markdown = new TurndownService().turndown(html);
          return { content: [{ type: "text", text: markdown }] };
        }

        // 4. PDF (Metadata/Raw)
        if (mimeType === 'application/pdf') {
          return {
            content: [
              { type: "text", text: "[PDF Attachment Detected. Claude can process this using its internal tools if the raw bytes are provided.]" },
              { type: "resource", resource: { uri: `attachment://${args.messageId}/${args.attachmentId}`, mimeType: "application/pdf", blob: buffer.toString('base64') } }
            ]
          };
        }

        return { content: [{ type: "text", text: `Downloaded ${filename}. Use vision or text analysis as needed.` }] };
      }

      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`[Error] ${name}:`, error);
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gmail MCP Server active.");
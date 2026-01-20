import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { MongoClient } from "mongodb";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import TurndownService from "turndown";

// --- INITIALIZATION & CONFIG ---
const app = express();
app.use(express.json());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, "token.json");

// MongoDB Setup
let mongoClient = null;
let mongoDb = null;
async function connectToMongoDB() {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGODB_DATABASE);
  }
  return mongoDb;
}

// Gmail Auth Setup
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];

async function getAuthenticatedClient() {
  let credentials;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  } else {
    const content = await fs.readFile(path.join(__dirname, "credentials.json"));
    credentials = JSON.parse(content);
  }
  const { client_secret, client_id, redirect_uris } =
    credentials.installed || credentials.web;
  const rUri = process.env.REDIRECT_URI || redirect_uris[0];
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, rUri);
  try {
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    throw new Error("Missing token.json. Run auth script locally first.");
  }
}

// --- SUPER MCP SERVER DEFINITION ---
const server = new Server(
  {
    name: "super-mcp-server",
    version: "2.0.0",
  },
  {
    capabilities: { tools: {} },
  }
);

// --- LIST ALL TOOLS ---
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // GMAIL TOOLS
    {
      name: "search_emails",
      description: "Search emails using Gmail operators",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number", default: 5 },
        },
      },
    },
    {
      name: "read_email",
      description: "Get full email body and attachment IDs",
      inputSchema: {
        type: "object",
        properties: { messageId: { type: "string" } },
        required: ["messageId"],
      },
    },
    {
      name: "send_email",
      description: "Send customized email (text/html)",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          isHtml: { type: "boolean", default: false },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "get_attachment",
      description: "Processes attachments (Excel, Word, Images, PDF)",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          attachmentId: { type: "string" },
          mimeType: { type: "string" },
          filename: { type: "string" },
        },
        required: ["messageId", "attachmentId", "mimeType"],
      },
    },
    // MONGODB TOOLS
    {
      name: "list_collections",
      description: "List all collections",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "find_documents",
      description: "Find documents with optional filter",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          filter: { type: "object", default: {} },
          limit: { type: "number", default: 10 },
        },
        required: ["collection"],
      },
    },
    {
      name: "insert_document",
      description: "Insert a document",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          document: { type: "object" },
        },
        required: ["collection", "document"],
      },
    },
    {
      name: "update_documents",
      description: "Update documents",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          filter: { type: "object" },
          update: { type: "object" },
        },
        required: ["collection", "filter", "update"],
      },
    },
    {
      name: "delete_documents",
      description: "Delete documents",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          filter: { type: "object" },
        },
        required: ["collection", "filter"],
      },
    },
    {
      name: "aggregate",
      description: "Run aggregation pipeline",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          pipeline: { type: "array", items: { type: "object" } },
        },
        required: ["collection", "pipeline"],
      },
    },
    {
      name: "count_documents",
      description: "Count documents matching filter",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          filter: { type: "object", default: {} },
        },
        required: ["collection"],
      },
    },
    // EXCEL TOOLS
    {
      name: "create_excel_sheet",
      description: "Create a new Excel file with data",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string" },
          data: { type: "array", items: { type: "object" } },
          sheetName: { type: "string", default: "Sheet1" },
        },
        required: ["filename", "data"],
      },
    },
  ],
}));

// --- HANDLE TOOL CALLS ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    // GMAIL LOGIC
    if (
      ["search_emails", "read_email", "send_email", "get_attachment"].includes(
        name
      )
    ) {
      const auth = await getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth });

      if (name === "search_emails") {
        const res = await gmail.users.messages.list({
          userId: "me",
          q: args.query,
          maxResults: args.maxResults,
        });
        return {
          content: [
            { type: "text", text: JSON.stringify(res.data.messages || []) },
          ],
        };
      }
      if (name === "read_email") {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: args.messageId,
        });
        return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
      }
      if (name === "send_email") {
        const utf8Subject = `=?utf-8?B?${Buffer.from(args.subject).toString(
          "base64"
        )}?=`;
        const message = [
          `To: ${args.to}`,
          `Content-Type: ${
            args.isHtml ? "text/html" : "text/plain"
          }; charset=utf-8`,
          `MIME-Version: 1.0`,
          `Subject: ${utf8Subject}`,
          "",
          args.body,
        ].join("\n");
        const encoded = Buffer.from(message)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encoded },
        });
        return {
          content: [{ type: "text", text: `Email sent. ID: ${res.data.id}` }],
        };
      }
      if (name === "get_attachment") {
        const res = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: args.messageId,
          id: args.attachmentId,
        });
        const buffer = Buffer.from(res.data.data, "base64url");
        let mimeType = args.mimeType.toLowerCase();
        if (mimeType.startsWith("image/")) {
          const png = await sharp(buffer).png().toBuffer();
          return {
            content: [
              {
                type: "image",
                data: png.toString("base64"),
                mimeType: "image/png",
              },
            ],
          };
        }
        if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) {
          const wb = XLSX.read(buffer, { type: "buffer" });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          return { content: [{ type: "text", text: csv }] };
        }
        if (mimeType.includes("word")) {
          const { value } = await mammoth.convertToHtml({ buffer });
          const md = new TurndownService().turndown(value);
          return { content: [{ type: "text", text: md }] };
        }
        return { content: [{ type: "text", text: "File processed." }] };
      }
    }

    // MONGODB LOGIC
    if (
      [
        "list_collections",
        "find_documents",
        "insert_document",
        "update_documents",
        "delete_documents",
        "aggregate",
        "count_documents",
      ].includes(name)
    ) {
      const db = await connectToMongoDB();
      const collection = db.collection(args.collection);
      switch (name) {
        case "list_collections":
          const colls = await db.listCollections().toArray();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  colls.map((c) => c.name),
                  null,
                  2
                ),
              },
            ],
          };
        case "find_documents":
          const docs = await collection
            .find(args.filter || {})
            .limit(args.limit || 10)
            .toArray();
          return {
            content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
          };
        case "insert_document":
          const insRes = await collection.insertOne(args.document);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, insertedId: insRes.insertedId },
                  null,
                  2
                ),
              },
            ],
          };
        case "update_documents":
          const updRes = await collection.updateMany(args.filter, args.update);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    matchedCount: updRes.matchedCount,
                    modifiedCount: updRes.modifiedCount,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        case "delete_documents":
          const delRes = await collection.deleteMany(args.filter);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { success: true, deletedCount: delRes.deletedCount },
                  null,
                  2
                ),
              },
            ],
          };
        case "aggregate":
          const aggRes = await collection.aggregate(args.pipeline).toArray();
          return {
            content: [{ type: "text", text: JSON.stringify(aggRes, null, 2) }],
          };
        case "count_documents":
          const count = await collection.countDocuments(args.filter || {});
          return {
            content: [
              { type: "text", text: JSON.stringify({ count }, null, 2) },
            ],
          };
      }
    }

    // EXCEL LOGIC
    if (name === "create_excel_sheet") {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(args.data);
      XLSX.utils.book_append_sheet(wb, ws, args.sheetName || "Sheet1");
      const filePath = path.resolve(process.cwd(), args.filename);
      XLSX.writeFile(wb, filePath);
      return {
        content: [{ type: "text", text: `Excel file created: ${filePath}` }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
});

// --- SSE INFRASTRUCTURE ---
const sessions = new Map();
app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  sessions.set(transport.sessionId, transport);
  res.on("close", () => sessions.delete(transport.sessionId));
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const transport = sessions.get(req.query.sessionId);
  if (transport) await transport.handlePostMessage(req, res);
  else res.status(404).send("Session expired.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.error(`Super MCP Server live on port ${PORT}`));

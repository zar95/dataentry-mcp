import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

// MongoDB connection
let client = null;
let db = null;

async function connectToMongoDB() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(process.env.MONGODB_DATABASE);
    console.error("Connected to MongoDB");
  }
  return db;
}

// Create MCP server
const server = new Server(
  {
    name: "mongodb-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// We'll add handlers here next
// List all available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_collections",
        description: "List all collections in the database",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "find_documents",
        description: "Find documents in a collection with optional filter",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to query",
            },
            filter: {
              type: "object",
              description: "MongoDB filter object (optional)",
              default: {},
            },
            limit: {
              type: "number",
              description: "Maximum number of documents to return",
              default: 10,
            },
          },
          required: ["collection"],
        },
      },
      {
        name: "insert_document",
        description: "Insert a single document into a collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection",
            },
            document: {
              type: "object",
              description: "Document to insert",
            },
          },
          required: ["collection", "document"],
        },
      },
      {
        name: "update_documents",
        description: "Update documents in a collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection",
            },
            filter: {
              type: "object",
              description: "Filter to match documents",
            },
            update: {
              type: "object",
              description: "Update operations (e.g., {$set: {field: value}})",
            },
          },
          required: ["collection", "filter", "update"],
        },
      },
      {
        name: "delete_documents",
        description: "Delete documents from a collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection",
            },
            filter: {
              type: "object",
              description: "Filter to match documents to delete",
            },
          },
          required: ["collection", "filter"],
        },
      },
      {
        name: "aggregate",
        description: "Run an aggregation pipeline on a collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection",
            },
            pipeline: {
              type: "array",
              items: { type: "object" }, // <--- Add this line
              description: "Aggregation pipeline stages",
            },
          },
          required: ["collection", "pipeline"],
        },
      },
      {
        name: "count_documents",
        description: "Count documents in a collection matching a filter",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection",
            },
            filter: {
              type: "object",
              description: "Filter to match documents",
              default: {},
            },
          },
          required: ["collection"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const database = await connectToMongoDB();

    switch (name) {
      case "list_collections": {
        const collections = await database.listCollections().toArray();
        const collectionNames = collections.map((c) => c.name);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(collectionNames, null, 2),
            },
          ],
        };
      }

      case "find_documents": {
        const collection = database.collection(args.collection);
        const filter = args.filter || {};
        const limit = args.limit || 10;

        const documents = await collection
          .find(filter)
          .limit(limit)
          .toArray();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(documents, null, 2),
            },
          ],
        };
      }

      case "insert_document": {
        const collection = database.collection(args.collection);
        const result = await collection.insertOne(args.document);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                insertedId: result.insertedId,
              }, null, 2),
            },
          ],
        };
      }

      case "update_documents": {
        const collection = database.collection(args.collection);
        const result = await collection.updateMany(args.filter, args.update);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
              }, null, 2),
            },
          ],
        };
      }

      case "delete_documents": {
        const collection = database.collection(args.collection);
        const result = await collection.deleteMany(args.filter);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                deletedCount: result.deletedCount,
              }, null, 2),
            },
          ],
        };
      }

      case "aggregate": {
        const collection = database.collection(args.collection);
        const results = await collection.aggregate(args.pipeline).toArray();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "count_documents": {
        const collection = database.collection(args.collection);
        const filter = args.filter || {};
        const count = await collection.countDocuments(filter);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error.message,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});
// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MongoDB MCP Server running on stdio");
}

// Handle cleanup
process.on("SIGINT", async () => {
  if (client) {
    await client.close();
    console.error("MongoDB connection closed");
  }
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

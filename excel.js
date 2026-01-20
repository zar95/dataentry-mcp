import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const server = new Server({
    name: "excel-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "create_excel_sheet",
                description: "Create a new Excel file with provided data. Returns the path to the created file.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filename: {
                            type: "string",
                            description: "Name of the file to create (e.g. 'report.xlsx'). Will be saved in the current directory.",
                        },
                        data: {
                            type: "array",
                            items: {
                                type: "object",
                            },
                            description: "Array of objects representing the rows of the Excel sheet.",
                        },
                        sheetName: {
                            type: "string",
                            description: "Optional name for the worksheet. Defaults to 'Sheet1'.",
                        },
                    },
                    required: ["filename", "data"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "create_excel_sheet") {
            const { filename, data, sheetName = "Sheet1" } = args;

            // Create a new workbook
            const wb = XLSX.utils.book_new();

            // Convert JSON data to worksheet
            const ws = XLSX.utils.json_to_sheet(data);

            // Append worksheet to workbook
            XLSX.utils.book_append_sheet(wb, ws, sheetName);

            // Resolve absolute path
            const filePath = path.resolve(process.cwd(), filename);

            // Write to file
            XLSX.writeFile(wb, filePath);

            return {
                content: [
                    {
                        type: "text",
                        text: `Excel file created successfully at: ${filePath}`,
                    },
                ],
            };
        } else {
            throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error creating Excel file: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Excel MCP Server running on stdio");

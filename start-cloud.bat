@echo off
echo Starting Web MCP in Cloud Mode...
echo.

REM Set environment variables for cloud deployment
set MCP_TRANSPORT=sse
set MCP_HEADLESS=true
set MCP_PORT=8000

echo Configuration:
echo - Transport: SSE
echo - Headless: true
echo - Port: 8000
echo.
echo Server will be available at: http://localhost:8000
echo.

python web-mcp-cloud.py

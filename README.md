# Web MCP - Browser Automation Server

A Model Context Protocol (MCP) server that provides browser automation capabilities with human-like interactions using Playwright.

## Features

- 🌐 **Browser Automation**: Navigate, click, type with stealth mode
- 🤖 **Human-like Behavior**: Bezier curve mouse movements, realistic typing with typos
- 🔄 **Multi-tab Support**: Open, switch, and manage multiple browser tabs
- 📸 **Screenshots & Content**: Capture page screenshots and extract HTML content
- ☁️ **Cloud Ready**: Deploy to Railway, Render, or Google Cloud Run
- 🔌 **Dual Transport**: Supports both stdio (local) and SSE (cloud) protocols

## Tools Available

| Tool | Description |
|------|-------------|
| `navigate_to` | Navigate to a URL with stealth protection |
| `open_new_tab` | Open a new browser tab |
| `click_element` | Click an element with human-like mouse movement |
| `type_text` | Type text with realistic human behavior (typos, corrections) |
| `human_mouse` | Advanced mouse control with Bezier curves |
| `get_tab_count` | Get number of open tabs |
| `switch_to_tab` | Switch between tabs |
| `close_tab` | Close specific or current tab |
| `get_screenshot` | Capture page screenshot (base64) |
| `get_page_content` | Get HTML content of current page |

## Installation

### Local Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### Cloud Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed cloud deployment instructions.

## Usage

### Local Mode (stdio)

```bash
python web-mcp.py
```

Configure in Claude Desktop (`mcp_config.json`):
```json
{
  "mcpServers": {
    "web-mcp": {
      "command": "python",
      "args": ["C:/path/to/web-mcp.py"]
    }
  }
}
```

### Cloud Mode (SSE)

```bash
# Set environment variables
export MCP_TRANSPORT=sse
export MCP_HEADLESS=true
export MCP_PORT=8000

# Run server
python web-mcp-cloud.py
```

Configure in Claude Desktop:
```json
{
  "mcpServers": {
    "web-mcp-cloud": {
      "url": "https://your-deployment-url.com",
      "transport": "sse"
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `sse` | Transport protocol: `stdio` or `sse` |
| `MCP_HEADLESS` | `true` | Run browser in headless mode |
| `MCP_PORT` | `8000` | Port for SSE server |

## Examples

### Navigate and Search
```python
# Navigate to Google
navigate_to("https://google.com")

# Type in search box
type_text("textarea[name='q']", "Model Context Protocol")

# Click search button
click_element("input[name='btnK']")
```

### Multi-tab Workflow
```python
# Open multiple tabs
open_new_tab("https://github.com")
open_new_tab("https://stackoverflow.com")

# Check tab count
get_tab_count()  # Returns "3"

# Switch between tabs
switch_to_tab(0)  # First tab
switch_to_tab(1)  # Second tab

# Close a tab
close_tab(1)
```

### Advanced Mouse Control
```python
# Move mouse to element with human-like curve
human_mouse("button.login", "move")

# Click with realistic movement
human_mouse("button.submit", "click")

# Hover over element
human_mouse("nav a.dropdown", "hover")
```

## Architecture

### Local Mode
```
Client (Claude) <--stdio--> MCP Server <--> Playwright <--> Browser (visible)
```

### Cloud Mode
```
Client (Claude) <--SSE/HTTP--> MCP Server (cloud) <--> Playwright <--> Browser (headless)
```

## Security Notes

⚠️ **Current version has NO authentication**. For production use:
- Add API key authentication
- Use HTTPS
- Implement rate limiting
- Restrict CORS origins

## Requirements

- Python 3.11+
- Playwright
- MCP SDK
- playwright-stealth

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Support

For issues or questions, please open a GitHub issue.

# Web MCP - Cloud Deployment Guide

This MCP server can be deployed to the cloud so client machines can use it remotely via SSE (Server-Sent Events).

## 🚀 Quick Deploy Options

### Option 1: Railway (Recommended - Easiest)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy on Railway:**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect Python and install dependencies
   - Add these environment variables:
     - `MCP_TRANSPORT=sse`
     - `MCP_HEADLESS=true`
     - `MCP_PORT=8000`
   - Railway will provide a public URL like `https://your-app.railway.app`

### Option 2: Render

1. **Push to GitHub** (same as above)

2. **Deploy on Render:**
   - Go to [render.com](https://render.com)
   - Click "New" → "Web Service"
   - Connect your GitHub repo
   - Configure:
     - **Build Command:** `pip install -r requirements.txt && playwright install chromium && playwright install-deps chromium`
     - **Start Command:** `python web-mcp-cloud.py`
     - **Environment Variables:**
       - `MCP_TRANSPORT=sse`
       - `MCP_HEADLESS=true`
       - `MCP_PORT=8000`

### Option 3: Google Cloud Run (More Advanced)

1. **Install Google Cloud CLI**
2. **Deploy:**
   ```bash
   gcloud run deploy web-mcp \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars MCP_TRANSPORT=sse,MCP_HEADLESS=true,MCP_PORT=8000
   ```

## 🔧 Client Configuration

Once deployed, update your client's MCP config to connect to the cloud server:

### For Claude Desktop (or other MCP clients):

```json
{
  "mcpServers": {
    "web-mcp-cloud": {
      "url": "https://your-deployed-url.com",
      "transport": "sse"
    }
  }
}
```

Replace `https://your-deployed-url.com` with your actual deployment URL.

## 🧪 Testing Your Deployment

Test if your server is running:

```bash
curl https://your-deployed-url.com/health
```

## 📊 Key Differences: Local vs Cloud

| Feature | Local (stdio) | Cloud (SSE) |
|---------|--------------|-------------|
| **Transport** | stdio | SSE (HTTP) |
| **Browser Mode** | Visible (headless=false) | Headless (headless=true) |
| **Access** | Single machine only | Any client with internet |
| **Configuration** | File path in config | URL in config |
| **Use Case** | Personal automation | Team/multi-client use |

## 🔒 Security Considerations

**⚠️ IMPORTANT:** The current setup has NO authentication. Anyone with your URL can use your browser automation.

### Add Authentication (Recommended for Production):

You'll need to add API key authentication. Let me know if you need help implementing this!

## 💰 Cost Estimates

- **Railway:** Free tier available, ~$5-10/month for hobby use
- **Render:** Free tier available (with limitations), ~$7/month for starter
- **Google Cloud Run:** Pay-per-use, typically $1-5/month for light use

## 🐛 Troubleshooting

### Browser fails to launch
- Ensure Playwright dependencies are installed
- Check that headless mode is enabled (`MCP_HEADLESS=true`)

### Connection timeout
- Verify the port is correctly exposed (8000)
- Check firewall settings on your cloud platform

### "Module not found" errors
- Ensure `requirements.txt` is properly deployed
- Check build logs for installation errors

## 📝 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `sse` | Transport protocol (sse or stdio) |
| `MCP_HEADLESS` | `true` | Run browser in headless mode |
| `MCP_PORT` | `8000` | Port for SSE server |

## 🔄 Local Testing (Before Deploying)

Test the cloud version locally:

```bash
# Install dependencies
pip install -r requirements.txt
playwright install chromium

# Run in cloud mode
set MCP_TRANSPORT=sse
set MCP_HEADLESS=true
set MCP_PORT=8000
python web-mcp-cloud.py
```

Then test from another terminal:
```bash
curl http://localhost:8000
```

## 📚 Next Steps

1. ✅ Push code to GitHub
2. ✅ Deploy to Railway/Render
3. ✅ Update client config with deployment URL
4. ✅ Test connection
5. 🔒 Add authentication (recommended)
6. 📊 Monitor usage and costs

# ===== FORCE RAILWAY HOST & PORT =====
import os

os.environ["HOST"] = "0.0.0.0"              # bind to all interfaces
if "PORT" in os.environ:
    os.environ["MCP_PORT"] = os.environ["PORT"]  # FastMCP will use this

# ===== IMPORTS =====
import asyncio
import sys
import random
from mcp.server.fastmcp import FastMCP
from playwright.async_api import async_playwright, Page, Browser, Playwright
from playwright_stealth import Stealth

# ===== CONFIG =====
TRANSPORT = os.getenv("MCP_TRANSPORT", "sse")   # cloud = sse
HEADLESS = os.getenv("MCP_HEADLESS", "true").lower() == "true"

# Windows fix (local only)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# ===== MCP =====
mcp = FastMCP("WebNavigator")

playwright: Playwright | None = None
browser: Browser | None = None
page: Page | None = None
stealth = Stealth()

# ===== BROWSER =====
async def get_page() -> Page:
    global playwright, browser, page

    if page and not page.is_closed():
        return page

    if browser and browser.is_connected():
        context = await browser.new_context()
        page = await context.new_page()
        await stealth.apply_stealth_async(page)
        return page

    playwright = await async_playwright().start()

    browser = await playwright.chromium.launch(
        headless=HEADLESS,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
        ],
    )

    context = await browser.new_context()
    page = await context.new_page()
    await stealth.apply_stealth_async(page)
    return page

# ===== TOOLS =====
@mcp.tool()
async def navigate_to(url: str) -> str:
    p = await get_page()
    await p.goto(url, wait_until="domcontentloaded")
    return "OK"


@mcp.tool()
async def click_element(selector: str) -> str:
    p = await get_page()
    loc = p.locator(selector).first
    if await loc.count() == 0:
        return "ERROR"

    box = await loc.bounding_box()
    if not box:
        return "ERROR"

    tx = box["x"] + box["width"] / 2
    ty = box["y"] + box["height"] / 2
    await p.mouse.click(tx, ty)
    return "OK"


@mcp.tool()
async def type_text(selector: str, text: str) -> str:
    p = await get_page()
    loc = p.locator(selector).first
    if await loc.count() == 0:
        return "ERROR"

    await loc.click()
    await p.keyboard.type(text, delay=random.randint(60, 120))
    return "OK"


@mcp.tool()
async def get_screenshot() -> str:
    p = await get_page()
    img = await p.screenshot(full_page=True)
    import base64
    return base64.b64encode(img).decode()

# ===== RUN =====
if __name__ == "__main__":
    # FastMCP manages SSE server itself
    mcp.run(transport="sse")

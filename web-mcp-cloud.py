import asyncio
import sys
import os
import random
from mcp.server.fastmcp import FastMCP
from playwright.async_api import async_playwright, Page, Browser, Playwright
from playwright_stealth import Stealth

# ================== ENV ==================

os.environ["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"

TRANSPORT = os.getenv("MCP_TRANSPORT", "sse")  # sse for cloud, stdio for local
HEADLESS = os.getenv("MCP_HEADLESS", "true").lower() == "true"
PORT = int(os.getenv("PORT", os.getenv("MCP_PORT", "8000")))

# Windows event loop fix (local only)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# ================== MCP ==================

mcp = FastMCP("WebNavigator")

playwright: Playwright | None = None
browser: Browser | None = None
page: Page | None = None
stealth = Stealth()

# ================== BROWSER ==================

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

# ================== HUMAN MOUSE ==================

async def move_mouse_human_like(page: Page, sx, sy, ex, ey, duration=1.5):
    steps = int(duration * 60)

    cx1 = sx + (ex - sx) * 0.25 + random.uniform(-40, 40)
    cy1 = sy + (ey - sy) * 0.25 + random.uniform(-40, 40)
    cx2 = sx + (ex - sx) * 0.75 + random.uniform(-40, 40)
    cy2 = sy + (ey - sy) * 0.75 + random.uniform(-40, 40)

    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 3 * sx + 3 * (1 - t) ** 2 * t * cx1 + 3 * (1 - t) * t ** 2 * cx2 + t ** 3 * ex
        y = (1 - t) ** 3 * sy + 3 * (1 - t) ** 2 * t * cy1 + 3 * (1 - t) * t ** 2 * cy2 + t ** 3 * ey
        await page.mouse.move(x, y)
        await asyncio.sleep(duration / steps)

# ================== TOOLS ==================

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

    sx = random.uniform(100, 600)
    sy = random.uniform(100, 400)
    tx = box["x"] + box["width"] / 2
    ty = box["y"] + box["height"] / 2

    await move_mouse_human_like(p, sx, sy, tx, ty, 1.2)
    await p.mouse.click(tx, ty)
    return "OK"


@mcp.tool()
async def type_text(selector: str, text: str) -> str:
    p = await get_page()
    loc = p.locator(selector).first
    if await loc.count() == 0:
        return "ERROR"

    await loc.click()
    await p.keyboard.type(text, delay=random.randint(40, 120))
    return "OK"


@mcp.tool()
async def get_screenshot() -> str:
    p = await get_page()
    img = await p.screenshot(full_page=True)
    import base64
    return base64.b64encode(img).decode()

# ================== RUN ==================

if __name__ == "__main__":
    if TRANSPORT == "sse":
        import uvicorn
        uvicorn.run(
            "web-mcp-cloud:mcp",
            host="0.0.0.0",
            port=PORT,
            log_level="info",
        )
    else:
        mcp.run()

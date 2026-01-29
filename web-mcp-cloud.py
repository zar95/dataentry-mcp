import asyncio
import sys
import os
import subprocess
import random
import math
from mcp.server.fastmcp import FastMCP
from playwright.async_api import async_playwright, Page, Browser, Playwright
from playwright_stealth import Stealth

# Suppress Playwright download messages
os.environ['PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD'] = '1'

# Fix for Windows Event Loop RuntimeError on shutdown
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# Initialize MCP with SSE transport for cloud deployment
# Set transport to 'sse' for cloud, 'stdio' for local
TRANSPORT = os.getenv('MCP_TRANSPORT', 'sse')  # Default to SSE for cloud
HEADLESS = os.getenv('MCP_HEADLESS', 'true').lower() == 'true'  # Default headless for cloud
PORT = int(os.getenv('MCP_PORT', '8000'))  # Port for SSE server

mcp = FastMCP("WebNavigator")

# Global state
playwright: Playwright | None = None
browser: Browser | None = None
page: Page | None = None
stealth_plugin = Stealth()

async def get_page() -> Page:
    global browser, page, playwright
    
    # Check if existing page is valid
    if page and not page.is_closed():
        return page
        
    # Check if browser is valid, if so just make a new page
    if browser and browser.is_connected():
        context = await browser.new_context()
        page = await context.new_page()
        await stealth_plugin.apply_stealth_async(page)
        return page

    # Full initialization
    playwright = await async_playwright().start()
    
    # Use headless mode for cloud deployment
    browser = await playwright.chromium.launch(
        headless=HEADLESS,
        args=['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
    )
    context = await browser.new_context()
    page = await context.new_page()
    await stealth_plugin.apply_stealth_async(page)
    return page

async def move_mouse_human_like(page: Page, start_x: float, start_y: float, end_x: float, end_y: float, duration: float = 1.5):
    """Move mouse from start to end position using Bezier curve for human-like movement"""
    
    # Number of steps for smooth movement
    steps = int(duration * 60)  # 60 steps per second for smooth animation
    
    # Generate control points for Bezier curve (creates curved path)
    control_x1 = start_x + (end_x - start_x) * 0.25 + random.uniform(-50, 50)
    control_y1 = start_y + (end_y - start_y) * 0.25 + random.uniform(-50, 50)
    control_x2 = start_x + (end_x - start_x) * 0.75 + random.uniform(-50, 50)
    control_y2 = start_y + (end_y - start_y) * 0.75 + random.uniform(-50, 50)
    
    # Move along Bezier curve
    for i in range(steps + 1):
        t = i / steps
        
        # Cubic Bezier curve formula
        x = (1-t)**3 * start_x + 3*(1-t)**2*t * control_x1 + 3*(1-t)*t**2 * control_x2 + t**3 * end_x
        y = (1-t)**3 * start_y + 3*(1-t)**2*t * control_y1 + 3*(1-t)*t**2 * control_y2 + t**3 * end_y
        
        # Add small random jitter for more human-like movement
        jitter_x = random.uniform(-1, 1)
        jitter_y = random.uniform(-1, 1)
        
        await page.mouse.move(x + jitter_x, y + jitter_y)
        await asyncio.sleep(duration / steps)

@mcp.tool()
async def navigate_to(url: str) -> str:
    """Navigates to a URL with active stealth protection."""
    p = await get_page()
    await p.goto(url, wait_until="domcontentloaded")
    return "OK"

@mcp.tool()
async def open_new_tab(url: str) -> str:
    """Opens a new tab and navigates to the specified URL. This becomes the active page."""
    global browser, page
    
    # Ensure browser is running (initializes if needed)
    await get_page()
    
    # Create new page in the first context
    if browser and browser.contexts:
        context = browser.contexts[0]
        page = await context.new_page()
        await stealth_plugin.apply_stealth_async(page)
        await page.goto(url, wait_until="domcontentloaded")
        return "OK"
    return "ERROR"

@mcp.tool()
async def click_element(selector: str) -> str:
    """Clicks an element using human-like mouse movement."""
    p = await get_page()
    locator = p.locator(selector).first
    
    if await locator.count() == 0:
        return "ERROR"
    
    # Get element position
    box = await locator.bounding_box()
    if not box:
        return "ERROR"
    
    # Get current mouse position (or use random start)
    start_x = random.uniform(100, 500)
    start_y = random.uniform(100, 400)
    
    # Calculate target (center of element)
    target_x = box['x'] + box['width'] / 2
    target_y = box['y'] + box['height'] / 2
    
    # Move with human-like pattern
    await move_mouse_human_like(p, start_x, start_y, target_x, target_y, duration=1.5)
    
    # Click
    await p.mouse.click(target_x, target_y)
    return "OK"

@mcp.tool()
async def type_text(selector: str, text: str) -> str:
    """Types text into an element using human-like typing."""
    p = await get_page()
    locator = p.locator(selector).first
    
    if await locator.count() == 0:
        return "ERROR"
    
    # Get element position
    box = await locator.bounding_box()
    if not box:
        return "ERROR"
    
    # Get current mouse position (or use random start)
    start_x = random.uniform(100, 500)
    start_y = random.uniform(100, 400)
    
    # Calculate target (center of element)
    target_x = box['x'] + box['width'] / 2
    target_y = box['y'] + box['height'] / 2
    
    # Move with human-like pattern
    await move_mouse_human_like(p, start_x, start_y, target_x, target_y, duration=1.2)
    
    # Click to focus
    await p.mouse.click(target_x, target_y)
    await asyncio.sleep(0.2)
    
    # Type with human-like behavior (mistakes, corrections, variable speed)
    await type_like_human(p, selector, text)
    return "OK"

async def type_like_human(page: Page, selector: str, text: str):
    """Types text with human-like behavior including typos and corrections"""
    
    # Keyboard layout for common typos (adjacent keys)
    adjacent_keys = {
        'a': ['s', 'q', 'w', 'z'],
        'b': ['v', 'g', 'h', 'n'],
        'c': ['x', 'd', 'f', 'v'],
        'd': ['s', 'e', 'r', 'f', 'c', 'x'],
        'e': ['w', 'r', 'd'],
        'f': ['d', 'r', 't', 'g', 'v', 'c'],
        'g': ['f', 't', 'y', 'h', 'b', 'v'],
        'h': ['g', 'y', 'u', 'j', 'n', 'b'],
        'i': ['u', 'o', 'k'],
        'j': ['h', 'u', 'i', 'k', 'm', 'n'],
        'k': ['j', 'i', 'o', 'l', 'm'],
        'l': ['k', 'o', 'p'],
        'm': ['n', 'j', 'k'],
        'n': ['b', 'h', 'j', 'm'],
        'o': ['i', 'p', 'l'],
        'p': ['o', 'l'],
        'q': ['w', 'a'],
        'r': ['e', 't', 'f', 'd'],
        's': ['a', 'w', 'e', 'd', 'x', 'z'],
        't': ['r', 'y', 'g', 'f'],
        'u': ['y', 'i', 'j', 'h'],
        'v': ['c', 'f', 'g', 'b'],
        'w': ['q', 'e', 's', 'a'],
        'x': ['z', 's', 'd', 'c'],
        'y': ['t', 'u', 'h', 'g'],
        'z': ['a', 's', 'x'],
    }
    
    i = 0
    while i < len(text):
        char = text[i]
        
        # 15% chance of making a typo
        if random.random() < 0.15 and char.lower() in adjacent_keys:
            # Type wrong character (adjacent key)
            wrong_char = random.choice(adjacent_keys[char.lower()])
            if char.isupper():
                wrong_char = wrong_char.upper()
            
            # Type the wrong character
            await page.keyboard.press(wrong_char)
            await asyncio.sleep(random.uniform(0.05, 0.15))
            
            # Pause (realizing the mistake)
            await asyncio.sleep(random.uniform(0.2, 0.5))
            
            # Press backspace to correct
            await page.keyboard.press('Backspace')
            await asyncio.sleep(random.uniform(0.1, 0.2))
        
        # Type the correct character
        await page.keyboard.press(char)
        
        # Variable typing speed (50ms to 250ms between keys)
        # Longer pauses after punctuation or spaces
        if char in ['.', ',', '!', '?']:
            await asyncio.sleep(random.uniform(0.3, 0.6))
        elif char == ' ':
            await asyncio.sleep(random.uniform(0.15, 0.35))
        else:
            await asyncio.sleep(random.uniform(0.05, 0.25))
        
        i += 1

@mcp.tool()
async def get_tab_count() -> str:
    """Returns the number of open tabs (pages) in the browser."""
    global browser
    if browser and browser.contexts:
        count = len(browser.contexts[0].pages)
        return str(count)
    return "0"

@mcp.tool()
async def switch_to_tab(tab_index: int) -> str:
    """Switches to a specific tab by index (0-based). Tab 0 is the first tab, tab 1 is the second, etc."""
    global browser, page
    
    if not browser or not browser.contexts:
        return "ERROR"
    
    context = browser.contexts[0]
    pages = context.pages
    
    if tab_index < 0 or tab_index >= len(pages):
        return "ERROR"
    
    page = pages[tab_index]
    await page.bring_to_front()
    return "OK"

@mcp.tool()
async def close_tab(tab_index: int = -1) -> str:
    """Closes a tab. If tab_index is provided, closes that specific tab (0-based index). 
    If tab_index is -1 (default), closes the current active tab."""
    global browser, page
    
    if not browser or not browser.contexts:
        return "ERROR"
    
    context = browser.contexts[0]
    pages = context.pages
    
    if len(pages) == 0:
        return "ERROR"
    
    # If tab_index is -1, close the current page
    if tab_index == -1:
        if page and not page.is_closed():
            await page.close()
            # Switch to the last remaining tab if any exist
            if len(context.pages) > 0:
                page = context.pages[-1]
                await page.bring_to_front()
                return "OK"
            else:
                page = None
                return "OK"
        return "ERROR"
    
    # Close specific tab by index
    if tab_index < 0 or tab_index >= len(pages):
        return "ERROR"
    
    tab_to_close = pages[tab_index]
    await tab_to_close.close()
    
    # Update the active page reference if we closed the current page
    if page == tab_to_close:
        if len(context.pages) > 0:
            page = context.pages[-1]
            await page.bring_to_front()
            return "OK"
        else:
            page = None
            return "OK"
    
    return "OK"

@mcp.tool()
async def human_mouse(selector: str, action: str = "move") -> str:
    """Finds an element by CSS selector and moves the mouse to it using SLOW, VISIBLE human-like movement patterns.
    
    This tool uses a custom Bezier curve algorithm to create smooth, curved, VISIBLE mouse movements
    that mimic natural human behavior. The cursor will move slowly (1-2 seconds) along a curved path.
    
    Args:
        selector: CSS selector to find the element (e.g., 'button', '#login', '.submit-btn', 'a[href="/signup"]')
        action: Action to perform when reaching the element:
            - 'move': Just move the mouse to the element (default)
            - 'click': Move and click the element
            - 'double_click': Move and double-click the element
            - 'right_click': Move and right-click the element
            - 'hover': Move and hover over the element
    
    Returns:
        'OK' on success, 'ERROR' on failure
    
    Examples:
        human_mouse('button.login-btn', 'click')  # Find login button and click it
        human_mouse('#search-input', 'move')      # Move mouse to search input
        human_mouse('a[href="/signup"]', 'hover') # Hover over signup link
    """
    try:
        p = await get_page()
        
        # Find the element
        locator = p.locator(selector).first
        
        # Check if element exists
        if await locator.count() == 0:
            return "ERROR"
        
        # Wait for element to be visible
        await locator.wait_for(state="visible", timeout=5000)
        
        # Get element's bounding box to find center coordinates
        box = await locator.bounding_box()
        if not box:
            return "ERROR"
        
        # Calculate center of the element
        target_x = box['x'] + box['width'] / 2
        target_y = box['y'] + box['height'] / 2
        
        # Get current mouse position or use random start
        start_x = random.uniform(100, 800)
        start_y = random.uniform(100, 600)
        
        # Move to element using SLOW, VISIBLE human-like pattern (1.5-2.5 seconds)
        duration = random.uniform(1.5, 2.5)
        await move_mouse_human_like(p, start_x, start_y, target_x, target_y, duration)
        
        # Small pause to see the cursor at the element
        await asyncio.sleep(0.3)
        
        # Perform the requested action
        if action == "click":
            await p.mouse.click(target_x, target_y)
        elif action == "double_click":
            await p.mouse.click(target_x, target_y)
            await asyncio.sleep(0.2)
            await p.mouse.click(target_x, target_y)
        elif action == "right_click":
            await p.mouse.click(target_x, target_y, button="right")
        elif action == "hover":
            # Just hovering, movement already done
            await asyncio.sleep(0.5)
        # If action is "move", just the movement above is sufficient
        
        return "OK"
    except Exception as e:
        return "ERROR"

@mcp.tool()
async def get_screenshot() -> str:
    """Takes a screenshot of the current page and returns base64 encoded image."""
    try:
        p = await get_page()
        screenshot_bytes = await p.screenshot(full_page=True)
        import base64
        return base64.b64encode(screenshot_bytes).decode('utf-8')
    except Exception as e:
        return "ERROR"

@mcp.tool()
async def get_page_content() -> str:
    """Returns the HTML content of the current page."""
    try:
        p = await get_page()
        content = await p.content()
        return content
    except Exception as e:
        return "ERROR"

if __name__ == "__main__":
    if TRANSPORT == 'sse':
        # Run with SSE transport for cloud deployment
        # FastMCP reads HOST and PORT from environment variables
        os.environ['HOST'] = '0.0.0.0'
        os.environ['PORT'] = str(PORT)
        mcp.run(transport='sse')
    else:
        # Run with stdio transport for local deployment
        mcp.run()


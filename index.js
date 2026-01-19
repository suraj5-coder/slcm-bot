const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

(async () => {
  try {
    console.log("🚀 Starting SLCM Bot (SPA Mode)...");

    if (!process.env.SLCM_STATE) throw new Error("❌ SLCM_STATE Secret is missing!");

    // 1. COOKIE SETUP
    console.log("🍪 Parsing Cookies...");
    let cookies = JSON.parse(process.env.SLCM_STATE);
    cookies = cookies.map(c => {
      if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None';
      delete c.storeId; delete c.id;
      return c;
    });

    console.log("🖥️ Launching Browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();

    // 2. NAVIGATE TO HOME
    console.log("🔗 Navigating to Dashboard...");
    // We go to the main portal link you gave
    await page.goto('https://reva-university.my.site.com/StudentPortal/s/', { timeout: 60000 });
    
    console.log("📍 Landed at Home Page. Looking for Attendance button...");

    // 3. THE CLICK (Using the selector from your screenshot)
    try {
        // We wait for the specific div with title="Attendance"
        const selector = 'div[title="Attendance"]';
        await page.waitForSelector(selector, { timeout: 30000 });
        
        console.log("👆 Found Attendance icon. Clicking...");
        await page.click(selector);

    } catch (e) {
        console.error("❌ Could not find the Attendance button!");
        console.log("Debugging: taking screenshot...");
        await page.screenshot({ path: 'debug-error.png' });
        throw e;
    }

    // 4. WAIT FOR TABLE
    console.log("⏳ Waiting for Table to load...");
    // Wait for the "TOTAL CLASSES COMPLETED" header to appear
    await page.waitForSelector('text=TOTAL CLASSES COMPLETED', { timeout: 30000 });

    // 5. SCRAPE DATA
    console.log("📝 Reading Data...");
    const rows = await page.$$('tbody tr');
    let currentData = {};
    let updates = [];

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length < 5) continue; 
      
      // Scrape data based on column index
      const subject = await cells[2].innerText();
      const total = parseInt(await cells[5].innerText());
      const attended = parseInt(await cells[6].innerText());
      const percentage = await cells[7].innerText();

      currentData[subject] = { total, attended, percentage };
    }

    console.log(`✅ Scraped ${Object.keys(currentData).length} subjects.`);

    // 6. SAVE & ALERT
    let oldData = {};
    if (fs.existsSync('data.json')) {
      oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    }

    for (const [subject, stats] of Object.entries(currentData)) {
      const old = oldData[subject];
      
      // Logic: Only alert if "Total Classes" increased
      if (old && stats.total > old.total) {
        if (stats.attended > old.attended) {
          updates.push(`✅ **${subject}**: Present (${stats.percentage})`);
        } else {
          updates.push(`❌ **${subject}**: ABSENT (${stats.percentage})`);
        }
      }
    }

    // Save current data for tomorrow
    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

    // Send Discord Message
    if (updates.length > 0 && process.env.DISCORD_WEBHOOK) {
      const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });
      await webhook.send(`**📢 SLCM Update:**\n\n${updates.join('\n')}`);
      console.log("📨 Notification Sent!");
    } else {
      console.log("👍 No attendance changes detected.");
    }

    await browser.close();
    console.log("🎉 Success!");

  } catch (error) {
    console.error("\n💥 FATAL ERROR 💥");
    console.error(error.message);
    process.exit(1);
  }
})();

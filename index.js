const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

(async () => {
  try {
    console.log("🚀 Starting SLCM Bot...");

    // 1. CHECK SECRET
    if (!process.env.SLCM_STATE) {
      throw new Error("❌ SLCM_STATE Secret is missing!");
    }

    console.log("🍪 Parsing Cookies...");
    let cookies;
    try {
      cookies = JSON.parse(process.env.SLCM_STATE);
    } catch (e) {
      throw new Error("❌ SLCM_STATE is not valid JSON! Re-export cookies using EditThisCookie.");
    }

    // --- 🛠️ THE FIX: SANITIZE COOKIES 🛠️ ---
    // Playwright is strict. We must fix "sameSite" values and remove junk fields.
    cookies = cookies.map(cookie => {
      // 1. Fix sameSite (EditThisCookie gives "no_restriction", Playwright wants "None")
      if (cookie.sameSite === 'no_restriction' || cookie.sameSite === 'unspecified') {
        cookie.sameSite = 'None';
      }
      // 2. Remove fields Playwright doesn't like
      delete cookie.storeId; 
      delete cookie.id;
      return cookie;
    });
    console.log("✅ Cookies sanitized!");
    // ----------------------------------------

    // 2. LAUNCH BROWSER
    console.log("🖥️ Launching Browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    // Inject the cleaned cookies
    await context.addCookies(cookies);

    // 3. NAVIGATE
    const page = await context.newPage();
    console.log("🔗 Navigating to Reva SLCM...");
    
    // Using the exact URL from your screenshot
    await page.goto('https://reva.edu.in/slcm/student/attendance', { timeout: 60000 });

    console.log("👀 Checking for Attendance Table...");
    await page.waitForSelector('tbody tr', { timeout: 60000 });

    // 4. SCRAPE DATA
    console.log("📝 Reading Data...");
    const rows = await page.$$('tbody tr');
    let currentData = {};
    let updates = [];

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length < 5) continue; 

      // COLUMNS BASED ON YOUR IMAGE:
      // Index 2: Subject
      // Index 5: Total Classes
      // Index 6: Attended
      // Index 7: Percentage
      const subject = await cells[2].innerText();
      const total = parseInt(await cells[5].innerText());
      const attended = parseInt(await cells[6].innerText());
      const percentage = await cells[7].innerText();

      currentData[subject] = { total, attended, percentage };
    }

    console.log(`✅ Scraped ${Object.keys(currentData).length} subjects.`);

    // 5. COMPARE & SAVE
    let oldData = {};
    if (fs.existsSync('data.json')) {
      oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    }

    for (const [subject, stats] of Object.entries(currentData)) {
      const old = oldData[subject];
      if (old && stats.total > old.total) {
        if (stats.attended > old.attended) {
          updates.push(`✅ **${subject}**: Present (${stats.percentage})`);
        } else {
          updates.push(`❌ **${subject}**: ABSENT (${stats.percentage})`);
        }
      }
    }

    // Save Data
    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

    // Send Alert
    if (updates.length > 0 && process.env.DISCORD_WEBHOOK) {
      const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });
      await webhook.send(`**📢 SLCM Attendance Update:**\n\n${updates.join('\n')}`);
      console.log("📨 Discord Notification Sent!");
    } else {
      console.log("👍 No changes detected.");
    }

    await browser.close();
    console.log("🎉 Done!");

  } catch (error) {
    console.error("\n💥 FATAL ERROR 💥");
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();

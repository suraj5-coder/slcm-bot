const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

(async () => {
  try {
    console.log("🚀 Starting SLCM Bot (Custom Alerts Mode)...");

    if (!process.env.SLCM_STATE) throw new Error("❌ SLCM_STATE Secret is missing!");

    // --- 1. COOKIE SETUP ---
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

    // --- 2. NAVIGATE & CLICK ---
    console.log("🔗 Navigating to Dashboard...");
    await page.goto('https://reva-university.my.site.com/StudentPortal/s/', { timeout: 60000 });
    
    console.log("📍 Looking for Attendance button...");
    const selector = 'div[title="Attendance"]';
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.click(selector);

    console.log("⏳ Waiting for Table...");
    await page.waitForSelector('text=TOTAL CLASSES COMPLETED', { timeout: 30000 });

    // --- 3. SCRAPE DATA ---
    console.log("📝 Reading Data...");
    const rows = await page.$$('tbody tr');
    let currentData = {};
    let overallStats = null;

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length < 5) continue; 
      
      let subject = await cells[2].innerText();
      // Check for "Total" row (sometimes in first column)
      const firstCell = await cells[0].innerText();
      if (firstCell.trim() === 'Total' || subject.trim() === 'Total') {
        subject = 'Total';
      }

      const total = parseInt(await cells[5].innerText());
      const attended = parseInt(await cells[6].innerText());
      const percentageText = await cells[7].innerText();
      const percentage = parseFloat(percentageText); 

      const stats = { total, attended, percentage, percentageText };

      if (subject === 'Total') {
        overallStats = stats;
      } else {
        currentData[subject] = stats;
      }
    }

    // --- 4. ANALYZE & ALERT ---
    let oldData = {};
    if (fs.existsSync('data.json')) {
      oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    }

    let updates = [];
    let warnings = [];

    // Check individual subjects
    for (const [subject, stats] of Object.entries(currentData)) {
      const old = oldData[subject];
      
      // A. Check for Daily Changes
      if (old && stats.total > old.total) {
        const ratio = `[${stats.attended}/${stats.total}]`;
        
        if (stats.attended > old.attended) {
          updates.push(`✅ **${subject}**\n   Present! (${stats.percentageText}) ${ratio}`);
        } else {
          updates.push(`❌ **${subject}**\n   ABSENT! (${stats.percentageText}) ${ratio}`);
        }
      }

      // B. Check for Low Attendance Thresholds
      if (stats.percentage < 75.0) {
        // STOP SIGN for < 75%
        warnings.push(`🛑 **${subject}** is CRITICAL: **${stats.percentageText}**`);
      } else if (stats.percentage < 78.0) {
        // WARNING SYMBOL for 75% - 77.9%
        warnings.push(`⚠️ **${subject}** is near limit: **${stats.percentageText}**`);
      }
    }

    // Check Overall Total
    if (overallStats) {
        if (overallStats.percentage < 75.0) {
            warnings.unshift(`🛑 **CRITICAL: OVERALL ATTENDANCE IS ${overallStats.percentageText}!**`);
        } else if (overallStats.percentage < 78.0) {
            warnings.unshift(`⚠️ **Warning: Overall Attendance is ${overallStats.percentageText}**`);
        }
    }

    // --- 5. SAVE & NOTIFY ---
    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

    // Construct the final message
    let finalMessage = "";

    // Add Updates first
    if (updates.length > 0) {
      finalMessage += `**📢 Daily SLCM Update:**\n\n${updates.join('\n\n')}\n\n`;
      if (overallStats) {
        finalMessage += `📊 **Overall Percentage:** ${overallStats.percentageText}\n`;
      }
    } 

    // Add Warnings if any exist (Send these even if no attendance changed today?)
    // Let's attach them if we have updates, OR if it's Sunday. 
    // To be safe, let's always append them if they exist so you never miss it.
    if (warnings.length > 0) {
        finalMessage += `\n**⚠️ ATTENDANCE ALERTS:**\n${warnings.join('\n')}`;
    }

    // Only send if there is something to say
    if (finalMessage.length > 0 && (updates.length > 0 || warnings.length > 0)) {
        await webhook.send(finalMessage);
        console.log("📨 Notification Sent!");
    } else {
        console.log("👍 No changes and no warnings.");
    }

    console.log("🎉 Done!");
    await browser.close();

  } catch (error) {
    console.error("💥 FATAL ERROR 💥");
    console.error(error.message);
    process.exit(1);
  }
})();

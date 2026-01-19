const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

(async () => {
  try {
    console.log("🚀 Starting SLCM Bot (Total Fix Mode)...");

    if (!process.env.SLCM_STATE) throw new Error("❌ SLCM_STATE Secret is missing!");

    // 1. COOKIE SETUP
    let cookies = JSON.parse(process.env.SLCM_STATE);
    cookies = cookies.map(c => {
      if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None';
      delete c.storeId; delete c.id;
      return c;
    });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();

    // 2. NAVIGATE
    await page.goto('https://reva-university.my.site.com/StudentPortal/s/', { timeout: 60000 });
    const selector = 'div[title="Attendance"]';
    await page.waitForSelector(selector, { timeout: 30000 });
    await page.click(selector);
    await page.waitForSelector('text=TOTAL CLASSES COMPLETED', { timeout: 30000 });

    // 3. SCRAPE (New Logic: Read from Right-to-Left)
    // We grab ALL rows, including those in <thead>, <tbody>, <tfoot> just to be safe
    const rows = await page.$$('tr'); 
    let currentData = {};
    let overallStats = null;

    for (const row of rows) {
      const cells = await row.$$('td');
      // Relaxed check: We only need the last 3 cells (Total, Attended, %)
      if (cells.length < 3) continue; 
      
      const count = cells.length;
      const rowText = await row.innerText();

      // --- SMART DATA EXTRACTION ---
      // We read from the END of the row because the "Total" row might have merged cells at the start.
      // Last Cell = Percentage
      // 2nd Last = Attended
      // 3rd Last = Total Classes
      
      const percentageText = await cells[count - 1].innerText();
      const attendedText = await cells[count - 2].innerText();
      const totalText = await cells[count - 3].innerText();

      // Clean the data (remove newlines, spaces)
      const total = parseInt(totalText.trim());
      const attended = parseInt(attendedText.trim());
      const percentage = parseFloat(percentageText.trim());

      // Valid number check (Skips header rows like "Subject", "Professor")
      if (isNaN(total) || isNaN(attended) || isNaN(percentage)) continue;

      // Identify Subject Name
      let subject = "";
      
      // If the row contains "Total", treat it as the Overall Row
      if (rowText.includes("Total") && !rowText.includes("TOTAL CLASSES")) {
        subject = "Total";
      } else {
        // For normal rows, Subject is usually in the 3rd column (Index 2)
        // Check bounds just in case
        if (count >= 3) {
            subject = await cells[2].innerText();
        } else {
            continue; // Skip weird rows
        }
      }

      // --- BUNK CALCULATOR ---
      let advice = "";
      if (subject !== 'Total') {
        if (percentage >= 75) {
           const canBunk = Math.floor((attended - 0.75 * total) / 0.75);
           if (canBunk > 0) advice = `😴 Bunkable: **${canBunk}** classes`;
           else advice = `🛡️ On the edge! Don't miss.`;
        } else {
           const need = Math.ceil((0.75 * total - attended) / 0.25);
           advice = `🚑 **MUST ATTEND: ${need}** next classes!`;
        }
      }
      // -----------------------

      const stats = { total, attended, percentage, percentageText, advice };
      
      if (subject === 'Total') {
        overallStats = stats;
        console.log(`✅ Found Overall Total: ${percentageText}`);
      } else {
        currentData[subject] = stats;
      }
    }

    // 4. COMPARE & NOTIFY
    let oldData = {};
    if (fs.existsSync('data.json')) {
      oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    }

    let updates = [];
    let warnings = [];

    // Detect Changes
    for (const [subject, stats] of Object.entries(currentData)) {
      const old = oldData[subject];
      if (old && stats.total > old.total) {
        const statusIcon = stats.attended > old.attended ? "✅" : "❌";
        const statusText = stats.attended > old.attended ? "Present" : "ABSENT";
        updates.push(`${statusIcon} **${subject}**\n${statusText} (${stats.percentageText}) [${stats.attended}/${stats.total}]\n${stats.advice}`);
      }
      // Add to warnings if low
      if (stats.percentage < 75.0) warnings.push(`🛑 **${subject}**: ${stats.percentageText} (${stats.advice})`);
      else if (stats.percentage < 78.0) warnings.push(`⚠️ **${subject}**: ${stats.percentageText} (${stats.advice})`);
    }

    // Save Data (Include Overall Stats in the file too!)
    if (overallStats) currentData['Total'] = overallStats;
    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

    let finalMessage = "";
    if (updates.length > 0) {
      finalMessage += `**📢 SLCM Update:**\n\n${updates.join('\n\n')}\n\n`;
    } 

    // Always show overall stats if updates happened OR if critical
    if (overallStats && (updates.length > 0 || overallStats.percentage < 75)) {
        const icon = overallStats.percentage < 75 ? "🛑" : "📊";
        finalMessage += `${icon} **Overall Percentage: ${overallStats.percentageText}**\n`;
    }

    if (warnings.length > 0) {
        finalMessage += `\n**⚠️ ATTENDANCE ALERTS:**\n${warnings.join('\n')}`;
    }

    if (finalMessage) await webhook.send(finalMessage);

    await browser.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();

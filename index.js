const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

(async () => {
  try {
    console.log("🚀 Starting SLCM Bot (Bunk Calculator Mode)...");

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

    // 3. SCRAPE
    const rows = await page.$$('tbody tr');
    let currentData = {};
    let overallStats = null;

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length < 5) continue; 
      
      let subject = await cells[2].innerText();
      const firstCell = await cells[0].innerText();
      if (firstCell.trim() === 'Total' || subject.trim() === 'Total') subject = 'Total';

      const total = parseInt(await cells[5].innerText());
      const attended = parseInt(await cells[6].innerText());
      const percentageText = await cells[7].innerText();
      const percentage = parseFloat(percentageText); 

      // --- 🧮 BUNK CALCULATOR LOGIC 🧮 ---
      let advice = "";
      if (subject !== 'Total') {
        if (percentage >= 75) {
           // Formula: How many classes can I miss?
           // (Attended) / (Total + x) >= 0.75
           const canBunk = Math.floor((attended - 0.75 * total) / 0.75);
           if (canBunk > 0) advice = `😴 Bunkable: **${canBunk}** classes`;
           else advice = `🛡️ On the edge! Don't miss.`;
        } else {
           // Formula: How many must I attend?
           // (Attended + x) / (Total + x) >= 0.75
           const need = Math.ceil((0.75 * total - attended) / 0.25);
           advice = `🚑 **MUST ATTEND: ${need}** next classes!`;
        }
      }
      // -----------------------------------

      const stats = { total, attended, percentage, percentageText, advice };
      if (subject === 'Total') overallStats = stats;
      else currentData[subject] = stats;
    }

    // 4. COMPARE & NOTIFY
    let oldData = {};
    if (fs.existsSync('data.json')) {
      oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    }

    let updates = [];
    let warnings = [];

    for (const [subject, stats] of Object.entries(currentData)) {
      const old = oldData[subject];
      
      if (old && stats.total > old.total) {
        const statusIcon = stats.attended > old.attended ? "✅" : "❌";
        const statusText = stats.attended > old.attended ? "Present" : "ABSENT";
        
        updates.push(`${statusIcon} **${subject}**\n${statusText} (${stats.percentageText}) [${stats.attended}/${stats.total}]\n${stats.advice}`);
      }

      if (stats.percentage < 75.0) warnings.push(`🛑 **${subject}**: ${stats.percentageText} (${stats.advice})`);
      else if (stats.percentage < 78.0) warnings.push(`⚠️ **${subject}**: ${stats.percentageText} (${stats.advice})`);
    }

    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));
    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

    let finalMessage = "";
    if (updates.length > 0) {
      finalMessage += `**📢 SLCM Update:**\n\n${updates.join('\n\n')}\n\n`;
      if (overallStats) finalMessage += `📊 **Overall: ${overallStats.percentageText}**`;
    } 

    if (warnings.length > 0) {
        finalMessage += `\n\n**⚠️ ATTENDANCE ALERTS:**\n${warnings.join('\n')}`;
    }

    if (finalMessage) await webhook.send(finalMessage);

    await browser.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();

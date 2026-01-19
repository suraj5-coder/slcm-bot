const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

// --- ⚙️ CONFIGURATION ZONE ⚙️ ---
// Set to TRUE for "Bunkable/Must Attend" slang.
// Set to FALSE for "Professional/Safe Margin" language (Safe for LinkedIn).
const STUDENT_MODE = true; 
// ---------------------------------

(async () => {
  try {
    console.log(`🚀 Starting SLCM Bot (Mode: ${STUDENT_MODE ? 'Student' : 'Professional'})...`);

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

    // 3. SCRAPE (Right-to-Left Strategy)
    const rows = await page.$$('tr'); 
    let currentData = {};
    let overallStats = null;

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length < 3) continue; 
      
      const count = cells.length;
      const rowText = await row.innerText();

      const percentageText = await cells[count - 1].innerText();
      const attendedText = await cells[count - 2].innerText();
      const totalText = await cells[count - 3].innerText();

      const total = parseInt(totalText.trim());
      const attended = parseInt(attendedText.trim());
      const percentage = parseFloat(percentageText.trim());

      if (isNaN(total) || isNaN(attended) || isNaN(percentage)) continue;

      let subject = "";
      if (rowText.includes("Total") && !rowText.includes("TOTAL CLASSES")) {
        subject = "Total";
      } else {
        if (count >= 3) subject = await cells[2].innerText();
        else continue;
      }

      // --- 🧮 CALCULATOR LOGIC (Runs in both modes) 🧮 ---
      let advice = "";
      if (subject !== 'Total') {
        if (percentage >= 75) {
           const buffer = Math.floor((attended - 0.75 * total) / 0.75);
           if (buffer > 0) {
               advice = STUDENT_MODE 
                 ? `😴 Bunkable: **${buffer}** classes`
                 : `🛡️ Safety Margin: **${buffer}** classes`;
           } else {
               advice = STUDENT_MODE 
                 ? `🛡️ On the edge! Don't miss.`
                 : `⚠️ Minimal Margin. Maintain attendance.`;
           }
        } else {
           const deficit = Math.ceil((0.75 * total - attended) / 0.25);
           advice = STUDENT_MODE 
             ? `🚑 **MUST ATTEND: ${deficit}** next classes!`
             : `📉 Deficit: Needs **${deficit}** classes to recover.`;
        }
      }
      // ----------------------------------------------------

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
      
      // Update Detection
      if (old && stats.total > old.total) {
        const statusIcon = stats.attended > old.attended ? "✅" : "❌";
        const statusText = stats.attended > old.attended ? "Present" : "ABSENT";
        updates.push(`${statusIcon} **${subject}**\n${statusText} (${stats.percentageText}) [${stats.attended}/${stats.total}]\n${stats.advice}`);
      }

      // Warning Thresholds
      if (stats.percentage < 75.0) warnings.push(`🛑 **${subject}**: ${stats.percentageText} (${stats.advice})`);
      else if (stats.percentage < 78.0) warnings.push(`⚠️ **${subject}**: ${stats.percentageText} (${stats.advice})`);
    }

    // Save Data
    if (overallStats) currentData['Total'] = overallStats;
    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

    let finalMessage = "";
    if (updates.length > 0) {
      finalMessage += `**📢 SLCM Update:**\n\n${updates.join('\n\n')}\n\n`;
    } 

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

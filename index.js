const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient } = require('discord.js');

// --- ⚙️ CONFIGURATION ⚙️ ---
const STUDENT_MODE = false; // Set FALSE for "Professional" (LinkedIn Safe)
// ----------------------------

(async () => {
  try {
    console.log(`🚀 Starting SLCM Bot (Semester Change Fix Mode)...`);

    if (!process.env.SLCM_STATE) throw new Error("❌ SLCM_STATE Secret is missing!");

    // 1. COOKIES
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

    // 2. NAVIGATE & DEBUG
    console.log("🔗 Navigating to Dashboard...");
    // You may need to verify this link if it differs from the last semester
    await page.goto('https://reva-university.my.site.com/StudentPortal/s/', { timeout: 60000 });
    
    // --- 🕵️ DEBUG MODE 🕵️ ---
    // This tells us if your cookies are active. If Title is "Login", refresh cookies.
    console.log(`📍 I am currently at: ${page.url()}`);
    console.log(`📑 Page Title is: "${await page.title()}"`);
    // -------------------------

    console.log("📍 Looking for Attendance button...");
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

      // CLEAN THE DATA (remove newlines, spaces)
      const total = parseInt(totalText.trim());
      const attended = parseInt(attendedText.trim());
      const percentage = parseFloat(percentageText.trim());

      // Valid number check (Skips header rows like "Subject", "Professor")
      if (isNaN(total) || isNaN(attended) || isNaN(percentage)) continue;

      // Identify Subject Name
      let subject = "";
      if (rowText.includes("Total") && !rowText.includes("TOTAL CLASSES")) subject = "Total";
      else if (count >= 3) subject = await cells[2].innerText();
      else continue;

      let advice = "";
      let stats;

      // --- 🚑 FIXED: Handle Subjects with 0 Classes ---
      // This directly fixes the 'NaN' issue from your 2nd image.
      if (total === 0) {
        advice = "Waiting for first class...";
        // We set default values so the comparison logic doesn't crash later
        stats = { total: 0, attended: 0, percentage: 0, percentageText: '0%', advice };
      } else {
        // --- CALCULATOR LOGIC (Runs only if Total > 0) ---
        if (subject !== 'Total') {
          if (percentage >= 75) {
             const buffer = Math.floor((attended - 0.75 * total) / 0.75);
             advice = STUDENT_MODE 
               ? `😴 Bunkable: **${buffer}** classes`
               : `🛡️ Safety Margin: **${buffer}** classes`;
          } else {
             const deficit = Math.ceil((0.75 * total - attended) / 0.25);
             advice = STUDENT_MODE 
               ? `🚑 **MUST ATTEND: ${deficit}** next classes!`
               : `📉 Deficit: Needs **${deficit}** classes.`;
          }
        }
        stats = { total, attended, percentage, percentageText, advice };
      }

      if (subject === 'Total') overallStats = stats;
      else currentData[subject] = stats;
    }

    // --- 4. DATA PIPELINE ---
    // Skip history logging if overallStats is missing (means page didn't load right)
    if (overallStats) {
        const today = new Date().toISOString().split('T')[0];
        let csvLine = `${today},Overall,${overallStats.percentage}\n`;
        if (!fs.existsSync('history.csv')) fs.writeFileSync('history.csv', 'Date,Subject,Percentage\n');
        fs.appendFileSync('history.csv', csvLine);
        console.log("📂 Data archived to history.csv");
    }

    // 5. COMPARE & NOTIFY
    let oldData = {};
    if (fs.existsSync('data.json')) {
      oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    }

    let updates = [];
    let warnings = [];

    for (const [subject, stats] of Object.entries(currentData)) {
      // SKIP NEW SEMESTER SUBJECTS that have 0 total classes from old data comparison
      if (stats.total === 0) continue; 
      
      const old = oldData[subject];
      if (old && stats.total > old.total) {
        const statusIcon = stats.attended > old.attended ? "✅" : "❌";
        const statusText = stats.attended > old.attended ? "Present" : "ABSENT";
        updates.push(`${statusIcon} **${subject}**\n${statusText} (${stats.percentageText}) [${stats.attended}/${stats.total}]\n${stats.advice}`);
      }

      if (stats.percentage < 75.0) warnings.push(`🛑 **${subject}**: ${stats.percentageText} (${stats.advice})`);
      else if (stats.percentage < 78.0) warnings.push(`⚠️ **${subject}**: ${stats.percentageText} (${stats.advice})`);
    }

    // Save State
    if (overallStats) currentData['Total'] = overallStats;
    fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

    let finalMessage = "";
    if (updates.length > 0) {
      finalMessage += `**📢 SLCM Update:**\n\n${updates.join('\n\n')}\n\n`;
      if (overallStats) finalMessage += `📊 **Overall: ${overallStats.percentageText}**`;
    } 

    if (warnings.length > 0) finalMessage += `\n\n**⚠️ ALERTS:**\n${warnings.join('\n')}`;

    if (finalMessage) await webhook.send(finalMessage);

    await browser.close();
    console.log("🎉 Done!");

  } catch (error) {
    console.error("\n💥 FATAL ERROR 💥");
    console.error(error.message);
    process.exit(1);
  }
})();

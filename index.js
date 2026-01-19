const { chromium } = require('playwright');
const fs = require('fs');
const { WebhookClient, EmbedBuilder } = require('discord.js');

(async () => {
  // 1. SETUP: Launch Browser (Headless = Invisible)
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // 2. AUTH: Inject your "Identity" (Cookies)
  if (process.env.SLCM_STATE) {
    const cookies = JSON.parse(process.env.SLCM_STATE);
    await context.addCookies(cookies);
  } else {
    console.error("❌ No cookies found! Check GitHub Secrets.");
    process.exit(1);
  }

  // 3. NAVIGATE
  const page = await context.newPage();
  console.log("Navigating to SLCM...");
  // NOTE: Verify this URL is the exact one where the table appears
  await page.goto('https://reva.edu.in/slcm/student/attendance'); 
  
  // Wait for the table to load (We look for the specific "TOTAL CLASSES" header)
  try {
    await page.waitForSelector('text="TOTAL CLASSES COMPLETED"', { timeout: 10000 });
  } catch (e) {
    console.error("❌ Login failed or Table not found. Cookies might be expired.");
    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });
    await webhook.send("⚠️ SLCM Bot Error: Cookie expired or page changed. Update GitHub Secrets!");
    process.exit(1);
  }

  // 4. SCRAPE DATA
  // We grab all rows from the table body
  const rows = await page.$$('tbody tr');
  
  let currentData = {};
  let updates = [];

  for (const row of rows) {
    const cells = await row.$$('td');
    if (cells.length < 5) continue; // Skip empty rows

    // Based on your screenshot columns:
    // Col 2 (Index 2): Subject Name (e.g., "Internet of Things")
    // Col 5 (Index 5): Total Classes (e.g., "22")
    // Col 6 (Index 6): Attended (e.g., "20")
    // Col 7 (Index 7): Percentage (e.g., "90.91%")
    
    const subject = await cells[2].innerText();
    const total = parseInt(await cells[5].innerText());
    const attended = parseInt(await cells[6].innerText());
    const percentage = await cells[7].innerText();

    // Store in our object
    currentData[subject] = { total, attended, percentage };
  }

  // 5. COMPARE WITH YESTERDAY
  let oldData = {};
  if (fs.existsSync('data.json')) {
    oldData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  }

  for (const [subject, stats] of Object.entries(currentData)) {
    const old = oldData[subject];
    
    if (old) {
      const classesIncreased = stats.total > old.total;
      const attendedIncreased = stats.attended > old.attended;

      if (classesIncreased) {
        if (attendedIncreased) {
          updates.push(`✅ **${subject}**: Marked **PRESENT** (${stats.percentage})`);
        } else {
          updates.push(`❌ **${subject}**: Marked **ABSENT** (${stats.percentage})`);
        }
      }
    }
  }

  // 6. SAVE & NOTIFY
  // Save today's data to be "Yesterday's data" for tomorrow
  fs.writeFileSync('data.json', JSON.stringify(currentData, null, 2));

  // Send Discord Alert only if there are updates
  if (updates.length > 0) {
    const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });
    const message = updates.join('\n');
    await webhook.send(`**📢 SLCM Attendance Update:**\n\n${message}`);
  } else {
    console.log("No attendance changes detected.");
  }

  await browser.close();
})();
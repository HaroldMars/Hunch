import { all, getSetting } from './db.js';
import { deliverEmail } from './email.js';
import { sendDailyReports } from './routes/admin.js';
import { localDay, nowIso } from './util.js';

export function startScheduler() {
  const tick = () => {
    try {
      // Scheduled emails that are due.
      all("SELECT id FROM emails WHERE folder = 'scheduled' AND scheduled_at <= ?", nowIso()).forEach((e) => deliverEmail(e.id));
      // Daily reports once per day after the configured hour.
      const hour = Number(getSetting('daily_report_hour')) || 18;
      const today = localDay();
      if (new Date().getHours() >= hour && getSetting('last_daily_report') !== today) {
        const n = sendDailyReports(today);
        console.log(`[hunch] Daily reports sent to ${n} staff members`);
      }
    } catch (err) {
      console.error('[hunch] scheduler error', err);
    }
  };
  tick();
  return setInterval(tick, 30e3);
}

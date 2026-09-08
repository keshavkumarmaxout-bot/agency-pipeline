import PgBoss from "pg-boss";
import { config } from "../config.ts";
import { QUEUES, CRONS, type QueueName } from "./queues.ts";

let boss: PgBoss | undefined;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;

  const instance = new PgBoss({
    connectionString: config.databaseUrl,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  });

  instance.on("error", (error: Error) => {
    console.error("[pg-boss]", error);
  });

  await instance.start();

  // pg-boss v10 requires queues to exist before send() or work().
  for (const name of Object.values(QUEUES)) {
    await instance.createQueue(name);
  }

  boss = instance;
  return instance;
}

export async function enqueue<T extends object>(
  queue: QueueName,
  data: T,
  options: PgBoss.SendOptions = {},
): Promise<string | null> {
  const instance = await getBoss();
  return instance.send(queue, data, options);
}

/**
 * Registers the cron schedules. Idempotent — pg-boss upserts by queue name, so
 * a redeploy does not create duplicate schedules.
 */
export async function registerCrons(): Promise<void> {
  const instance = await getBoss();
  for (const { queue, cron, note } of CRONS) {
    await instance.schedule(queue, cron, {}, { tz: "UTC" });
    console.log(`[cron] ${queue} @ ${cron} — ${note}`);
  }
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = undefined;
}

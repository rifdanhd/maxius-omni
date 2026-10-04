import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OfficeAgent, OfficeSnapshot } from "./types";
import { safeRecord } from "./privacy.mjs";

export const statusDirectory = () => path.resolve(process.env.AGENT_OFFICE_DIR || path.join(process.cwd(), ".agent-office"));
export const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);

export async function readAgent(id: string): Promise<OfficeAgent> {
  if (!validId(id)) throw new Error("ID agen tidak valid.");
  const filename = path.join(statusDirectory(), `${id}.json`);
  if ((await stat(filename)).size > 128 * 1024) throw new Error(`Status ${id} melebihi 128 KB.`);
  const record = JSON.parse(await readFile(filename, "utf8"));
  if (record.id !== id || !["name", "role", "task", "message", "updatedAt", "startedAt"].every(key => typeof record[key] === "string") ||
    !["working", "waiting", "done", "error"].includes(record.status) ||
    ![record.startedAt, record.updatedAt, ...(record.endedAt ? [record.endedAt] : [])].every(value => Number.isFinite(Date.parse(value)))) {
    throw new Error(`Format status ${id} tidak valid.`);
  }
  let resumePending = false;
  try {
    const command = JSON.parse(await readFile(path.join(statusDirectory(), "commands", `${id}.json`), "utf8"));
    resumePending = command.expectedUpdatedAt === record.updatedAt;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { ...safeRecord(record), resumePending };
}

export async function readSnapshot(): Promise<OfficeSnapshot> {
  let files: string[];
  try { files = await readdir(statusDirectory()); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    files = [];
  }
  const records = await Promise.all(files.filter(file => file.endsWith(".json") && validId(file.slice(0, -5))).sort().map(async file => {
    try { return await readAgent(file.slice(0, -5)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }));
  const agents = records.filter((agent): agent is OfficeAgent => agent !== null && (agent.status !== "done" || Date.now() - Date.parse(agent.endedAt || agent.updatedAt) < 300000));
  const visible = await Promise.all(agents.map(async agent => {
    try {
      const closed = JSON.parse(await readFile(path.join(statusDirectory(), "closed", `${agent.id}.json`), "utf8"));
      return agent.status === "error" && closed.updatedAt === agent.updatedAt ? null : agent;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return agent; throw error; }
  }));
  return { agents: visible.filter((agent): agent is OfficeAgent => agent !== null), source: process.env.AGENT_OFFICE_DIR ? "AGENT_OFFICE_DIR/*.json (lokal)" : ".agent-office/*.json", demo: false, updatedAt: new Date().toISOString() };
}

export async function closeAgent(id: string, expectedUpdatedAt: string) {
  const agent = await readAgent(id);
  if (agent.status !== "error" || agent.updatedAt !== expectedUpdatedAt) return false;
  const directory = path.join(statusDirectory(), "closed");
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${id}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ updatedAt: agent.updatedAt }), { mode: 0o600 });
  await rename(temporary, path.join(directory, `${id}.json`));
  return true;
}

export async function requestResume(id: string, expectedUpdatedAt: string) {
  const agent = await readAgent(id);
  if (agent.status !== "waiting" || !agent.canResume || agent.updatedAt !== expectedUpdatedAt) return false;
  const directory = path.join(statusDirectory(), "commands");
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${id}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ action: "resume", expectedUpdatedAt, requestedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, path.join(directory, `${id}.json`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await readAgent(id)).resumePending) return false;
  } finally { await unlink(temporary); }
  return true;
}

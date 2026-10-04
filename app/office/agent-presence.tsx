"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { OfficeAgent } from "@/lib/agent-office/types";

interface Entry { agent: OfficeAgent; leaving: boolean }

export function AgentPresence({ agents, children }: { agents: OfficeAgent[]; children: (agent: OfficeAgent, leaving: boolean) => ReactNode }) {
  const [previous, setPrevious] = useState(agents);
  const [entries, setEntries] = useState<Entry[]>(() => agents.map(agent => ({ agent, leaving: false })));
  if (agents !== previous) {
    setPrevious(agents);
    const ids = new Set(agents.map(agent => agent.id));
    setEntries([...agents.map(agent => ({ agent, leaving: false })), ...entries.filter(entry => !ids.has(entry.agent.id)).map(entry => ({ ...entry, leaving: true }))]);
  }
  const hasDepartures = entries.some(entry => entry.leaving);
  useEffect(() => {
    if (!hasDepartures) return;
    const timer = setTimeout(() => setEntries(current => current.filter(entry => !entry.leaving)), 420);
    return () => clearTimeout(timer);
  }, [hasDepartures, agents]);
  return entries.map(entry => children(entry.agent, entry.leaving));
}

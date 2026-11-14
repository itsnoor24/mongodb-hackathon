import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditEvent, RunDoc } from "../types";

function mergeEvents(prev: AuditEvent[], incoming: AuditEvent): AuditEvent[] {
  if (prev.some((e) => e._id === incoming._id)) return prev;
  return [...prev, incoming].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
}

export function useRunData(runId: string) {
  const [run, setRun] = useState<RunDoc | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seenRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { run: RunDoc; events: AuditEvent[] };
      setRun(data.run);
      setEvents(data.events);
      seenRef.current = new Set(data.events.map((e) => e._id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const url = `/api/events/stream?runId=${encodeURIComponent(runId)}`;
    const es = new EventSource(url);

    es.addEventListener("audit_event", (msg) => {
      const doc = JSON.parse(msg.data) as AuditEvent;
      if (seenRef.current.has(doc._id)) return;
      seenRef.current.add(doc._id);
      setEvents((prev) => mergeEvents(prev, doc));
    });

    es.onerror = () => {
      es.close();
      void load();
    };

    return () => es.close();
  }, [runId, load]);

  return { run, events, loading, error, reload: load, setRun };
}
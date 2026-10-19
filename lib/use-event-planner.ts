"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshSource } from '@/components/dashboard-refresh';
import { teamRequest, type TeamSchedule } from '@/lib/team-api';
import { validatePlan } from '@/lib/event-planner.mjs';
import type { PlannerData, PlannerState } from '@/lib/event-planner-types';

export function useEventPlanner(token: string, isEditing: boolean) {
  const [plan, setPlan] = useState<PlannerState | null>(null);
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false), sequence = useRef(0), editing = useRef(isEditing);
  editing.current = isEditing;

  const load = useCallback(async () => {
    if (inFlight.current) return false;
    const request = ++sequence.current;
    try {
      const [nextPlan, nextSchedule] = await Promise.all([
        teamRequest<PlannerState>(token, '/event-planner'),
        teamRequest<TeamSchedule>(token, '/schedule'),
      ]);
      if (request === sequence.current) {
        setPlan(nextPlan); setSchedule(nextSchedule); setError(''); setStale(false);
      }
      return true;
    } catch (caught) {
      if (request === sequence.current) setError(caught instanceof Error ? caught.message : 'Could not load the planner.');
      return false;
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !editing.current) void load();
    }, 60000);
    return () => { sequence.current++; clearInterval(timer); };
  }, [load]);
  useRefreshSource(useCallback(() => editing.current ? Promise.resolve(false) : load(), [load]));

  async function save(next: PlannerData, notice = 'Plan saved.') {
    if (!plan || inFlight.current || stale) return false;
    let checked;
    try { checked = validatePlan(next); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the plan details.');
      return false;
    }
    inFlight.current = true; const request = ++sequence.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await teamRequest<PlannerState>(token, '/event-planner', { ...checked, revision: plan.revision }, 'PUT');
      if (request !== sequence.current) return false;
      setPlan(result); setMessage(notice);
      return true;
    } catch (caught) {
      if (request === sequence.current) { setError(caught instanceof Error ? caught.message : 'Could not save.'); setStale(true); }
      return false;
    } finally {
      inFlight.current = false;
      if (request === sequence.current) setBusy(false);
    }
  }

  return { plan, schedule, busy, error, setError, message, disabled: busy || stale, load, save };
}

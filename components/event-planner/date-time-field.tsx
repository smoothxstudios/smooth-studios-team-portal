"use client";

import { Input } from '@/components/ui/input';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

export function PlannerDateTimeField({ label, value, onChange, required = false }: Props) {
  const [date = '', time = ''] = value.split('T');
  const needsBoth = required || Boolean(date || time);
  function update(nextDate: string, nextTime: string) {
    // Keep a partially entered pair in the draft so an optional end cannot
    // silently become "End TBD" while the user is still entering its time.
    onChange(nextDate || nextTime ? `${nextDate}T${nextTime}` : '');
  }

  return <fieldset className="planner-datetime">
    <legend>{label}</legend>
    <div className="planner-datetime-fields">
      <label>Date<Input type="date" aria-label={`${label} date`} required={needsBoth}
        value={date} onChange={event => update(event.target.value, time)} /></label>
      <label>Time<Input type="time" aria-label={`${label} time`} required={needsBoth} step={60}
        value={time} onChange={event => update(date, event.target.value)} /></label>
    </div>
  </fieldset>;
}

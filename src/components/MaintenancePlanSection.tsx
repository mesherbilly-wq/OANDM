import { useState } from 'react';
import {
  CalendarCheck, ChevronDown, ChevronRight, Plus, RotateCcw, Trash2,
} from 'lucide-react';
import {
  MAINTENANCE_FREQUENCIES,
  MAINTENANCE_PLAN_INTRO,
  cloneDefaultTasks,
  frequencySelectValue,
  maintenancePlanDisclaimer,
  maintenancePlanHasContent,
  maintenancePlanTitle,
  newMaintenanceTask,
  type MaintenancePlanDoc,
  type MaintenanceTask,
} from '../lib/maintenancePlanDefaults';

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
      <CalendarCheck className="w-10 h-10 text-slate-200 mx-auto mb-3" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  );
}

function FrequencyField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selected = frequencySelectValue(value);
  return (
    <div className="space-y-1">
      <select
        value={selected}
        disabled={disabled}
        onChange={event => {
          const next = event.target.value;
          onChange(next === 'Custom' ? (selected === 'Custom' ? value : '') : next);
        }}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:bg-slate-50"
      >
        {MAINTENANCE_FREQUENCIES.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      {selected === 'Custom' && (
        <input
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          placeholder="Custom frequency"
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:bg-slate-50"
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  readOnly,
  onChange,
  onRemove,
}: {
  task: MaintenanceTask;
  readOnly?: boolean;
  onChange: (patch: Partial<MaintenanceTask>) => void;
  onRemove: () => void;
}) {
  const cell = 'w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:border-transparent disabled:bg-transparent disabled:px-0';
  return (
    <tr className="align-top">
      <td className="px-3 py-2 w-[9.5rem]">
        <FrequencyField value={task.frequency} disabled={readOnly} onChange={frequency => onChange({ frequency })} />
      </td>
      <td className="px-3 py-2 w-[11rem]">
        <input
          value={task.activity}
          disabled={readOnly}
          onChange={event => onChange({ activity: event.target.value })}
          className={`${cell} font-medium`}
        />
      </td>
      <td className="px-3 py-2">
        <textarea
          value={task.requirement}
          disabled={readOnly}
          onChange={event => onChange({ requirement: event.target.value })}
          rows={2}
          className={`${cell} resize-y min-h-[2.5rem]`}
        />
      </td>
      <td className="px-3 py-2 w-[10.5rem]">
        <input
          value={task.evidence}
          disabled={readOnly}
          onChange={event => onChange({ evidence: event.target.value })}
          className={cell}
        />
      </td>
      {!readOnly && (
        <td className="px-2 py-2 w-10">
          <button
            type="button"
            onClick={onRemove}
            title="Remove activity"
            className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      )}
    </tr>
  );
}

function SystemPlanCard({
  systemName,
  plan,
  saving,
  readOnly,
  onChange,
  onSave,
}: {
  systemName: string;
  plan: MaintenancePlanDoc;
  saving: boolean;
  readOnly?: boolean;
  onChange: (plan: MaintenancePlanDoc) => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(true);
  const title = maintenancePlanTitle(systemName);
  const disclaimer = maintenancePlanDisclaimer(systemName);
  const count = plan.tasks.length;

  const updateTask = (id: string, patch: Partial<MaintenanceTask>) => {
    onChange({
      ...plan,
      tasks: plan.tasks.map(task => task.id === id ? { ...task, ...patch } : task),
    });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{count} maintenance activit{count === 1 ? 'y' : 'ies'}</p>
        </div>
        {maintenancePlanHasContent(plan) && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {disclaimer && (
            <p className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {disclaimer}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Frequency</th>
                  <th className="px-3 py-2">Maintenance Activity</th>
                  <th className="px-3 py-2">Recommended Action / Requirement</th>
                  <th className="px-3 py-2">Record / Evidence</th>
                  {!readOnly && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.tasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    readOnly={readOnly}
                    onChange={patch => updateTask(task.id, patch)}
                    onRemove={() => onChange({ ...plan, tasks: plan.tasks.filter(item => item.id !== task.id) })}
                  />
                ))}
                {plan.tasks.length === 0 && (
                  <tr>
                    <td colSpan={readOnly ? 4 : 5} className="px-3 py-6 text-center text-sm text-slate-400">
                      No maintenance activities. Add one below or reset to the default plan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 space-y-3 border-t border-slate-100">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project-specific notes</span>
              <textarea
                value={plan.notes}
                disabled={readOnly}
                onChange={event => onChange({ ...plan, notes: event.target.value })}
                rows={3}
                placeholder="Add site-specific maintenance requirements, exclusions, or contract notes…"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:bg-slate-50"
              />
            </label>

            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ ...plan, tasks: [...plan.tasks, newMaintenanceTask()] })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add maintenance activity
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Reset ${title} to the default maintenance plan? Edited and added activities for this system will be replaced.`)) return;
                    onChange({ ...plan, tasks: cloneDefaultTasks(systemName) });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to default
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="ml-auto rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MaintenancePlanSection({
  systemNames,
  plans,
  onChange,
  onSave,
  savingSystem,
  readOnly,
}: {
  systemNames: string[];
  plans: Record<string, MaintenancePlanDoc>;
  onChange: (systemName: string, plan: MaintenancePlanDoc) => void;
  onSave: (systemName: string) => void;
  savingSystem: string | null;
  readOnly?: boolean;
}) {
  if (systemNames.length === 0) {
    return <EmptyState message="No systems in this O&M yet. Add devices to a system to generate its maintenance plan." />;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-slate-400" />
          <h2 className="font-semibold text-slate-900">Planned Preventative Maintenance Schedule</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{MAINTENANCE_PLAN_INTRO}</p>
      </div>

      {systemNames.map(name => (
        <SystemPlanCard
          key={name}
          systemName={name}
          plan={plans[name] ?? { version: 1, notes: '', tasks: [] }}
          saving={savingSystem === name}
          readOnly={readOnly}
          onChange={plan => onChange(name, plan)}
          onSave={() => onSave(name)}
        />
      ))}
    </div>
  );
}

export function PrintMaintenancePlan({
  systemNames,
  plans,
}: {
  systemNames: string[];
  plans: Record<string, MaintenancePlanDoc>;
}) {
  const visible = systemNames.filter(name => maintenancePlanHasContent(plans[name]));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-700 leading-relaxed">{MAINTENANCE_PLAN_INTRO}</p>
      {visible.map(name => {
        const plan = plans[name];
        const disclaimer = maintenancePlanDisclaimer(name);
        return (
          <div key={name} className="mb-6">
            <h3 className="text-base font-bold text-slate-800 mb-2 border-b border-slate-200 pb-2">
              {maintenancePlanTitle(name)}
            </h3>
            {disclaimer && <p className="text-xs text-slate-600 mb-3 italic">{disclaimer}</p>}
            {plan.tasks.length > 0 && (
              <table className="om-maint-table w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left border border-slate-300 bg-slate-100 px-2 py-1.5 w-[16%]">Frequency</th>
                    <th className="text-left border border-slate-300 bg-slate-100 px-2 py-1.5 w-[18%]">Maintenance Activity</th>
                    <th className="text-left border border-slate-300 bg-slate-100 px-2 py-1.5">Recommended Action / Requirement</th>
                    <th className="text-left border border-slate-300 bg-slate-100 px-2 py-1.5 w-[18%]">Record / Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.tasks.map(task => (
                    <tr key={task.id}>
                      <td className="border border-slate-300 px-2 py-1.5 align-top">{task.frequency}</td>
                      <td className="border border-slate-300 px-2 py-1.5 align-top font-medium">{task.activity}</td>
                      <td className="border border-slate-300 px-2 py-1.5 align-top">{task.requirement}</td>
                      <td className="border border-slate-300 px-2 py-1.5 align-top">{task.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan.notes.trim() && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project-specific notes</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{plan.notes}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

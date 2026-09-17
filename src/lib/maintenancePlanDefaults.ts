export const MAINTENANCE_FREQUENCIES = [
  'Weekly',
  'Monthly',
  'Quarterly',
  'Six Monthly',
  'Annually',
  'Periodic',
  'As Required',
  'Manufacturer Recommended',
  'Custom',
] as const;

export type MaintenanceFrequency = (typeof MAINTENANCE_FREQUENCIES)[number];

export type MaintenancePlanKey =
  | 'cctv'
  | 'accessControl'
  | 'intruder'
  | 'intercom'
  | 'networks'
  | 'fireAlarm';

export interface MaintenanceTask {
  id: string;
  frequency: string;
  activity: string;
  requirement: string;
  evidence: string;
  systemGenerated: boolean;
}

export interface MaintenancePlanDoc {
  version: 1;
  notes: string;
  tasks: MaintenanceTask[];
}

export const MAINTENANCE_PLAN_INTRO =
  'The following maintenance schedule has been generated based on the systems included within this O&M manual. Maintenance frequencies are general recommendations and should be read in conjunction with the equipment manufacturer\'s requirements, applicable standards, contractual maintenance requirements and site-specific procedures.';

export const FIRE_ALARM_DISCLAIMER =
  'Fire alarm maintenance is life-safety critical. The final maintenance regime must comply with the applicable fire alarm standard, system category, manufacturer\'s requirements, fire risk assessment and site-specific procedures. For typical UK non-domestic systems reference BS 5839-1 where applicable.';

interface PlanTemplate {
  title: string;
  aliases: string[];
  disclaimer?: string;
  tasks: Array<Pick<MaintenanceTask, 'frequency' | 'activity' | 'requirement' | 'evidence'>>;
}

function taskId(planKey: string, frequency: string, activity: string): string {
  return `${planKey}-${frequency}-${activity}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ppm(
  frequency: string,
  activity: string,
  requirement: string,
  action: string,
  evidence: string,
): Pick<MaintenanceTask, 'frequency' | 'activity' | 'requirement' | 'evidence'> {
  return {
    frequency,
    activity,
    requirement: [requirement.trim(), action.trim()].filter(Boolean).join(' '),
    evidence,
  };
}

const PLAN_TEMPLATES: Record<MaintenancePlanKey, PlanTemplate> = {
  cctv: {
    title: 'CCTV',
    aliases: ['cctv'],
    tasks: [
      ppm('Monthly', 'System Status', 'Review system for reported faults, offline cameras, recording failures and system warnings.', 'Investigate and rectify outstanding faults.', 'System/Fault Log'),
      ppm('Quarterly', 'Camera Operation', 'Check operation of cameras and confirm expected images are available at the head-end.', 'Rectify defective or offline cameras.', 'Maintenance Record'),
      ppm('Quarterly', 'Camera Image Quality', 'Check image quality, focus, field of view, exposure and general scene coverage.', 'Clean, refocus or adjust where required.', 'Maintenance Record'),
      ppm('Quarterly', 'Camera Condition', 'Inspect cameras, housings, brackets, fixings and glands for damage, deterioration or tampering.', 'Repair or replace defective components.', 'Maintenance Record'),
      ppm('Quarterly', 'Camera Cleaning', 'Inspect and clean camera lenses, domes and housings as required.', 'Remove dirt, moisture, insects or other contamination affecting image quality.', 'Maintenance Record'),
      ppm('Six Monthly', 'Recording', 'Confirm cameras are recording correctly and recordings can be retrieved and played back.', 'Investigate recording or retrieval failures.', 'Maintenance Record'),
      ppm('Six Monthly', 'Retention', 'Check recorded footage retention against the configured/project requirement.', 'Investigate unexpected reductions in retention.', 'Maintenance Record'),
      ppm('Six Monthly', 'Time Synchronisation', 'Confirm cameras, servers, NVRs and workstations display the correct date/time and are synchronised where applicable.', 'Correct NTP/time configuration if required.', 'Maintenance Record'),
      ppm('Six Monthly', 'Storage', 'Check NVR/server storage health, RAID status and available capacity where applicable.', 'Replace failed drives or investigate storage warnings.', 'System Health Report'),
      ppm('Six Monthly', 'UPS', 'Check UPS status, alarms and battery condition where provided.', 'Replace batteries where condition or manufacturer recommendations require.', 'UPS Record'),
      ppm('Annually', 'Full Functional Test', 'Complete a full operational test of the CCTV system.', 'Record defects and recommendations.', 'Annual Maintenance Report'),
      ppm('Annually', 'User Controls', 'Test operator workstations, monitors, joysticks and viewing controls.', 'Repair or replace defective equipment.', 'Annual Maintenance Report'),
      ppm('Annually', 'Network/Connections', 'Inspect associated network connections, PoE status and communication to IP devices.', 'Investigate network faults affecting CCTV operation.', 'Annual Maintenance Report'),
      ppm('Annually', 'Documentation', 'Review camera schedules, device information and system drawings against the installed system.', 'Update O&M information where changes have been made.', 'Updated Documentation'),
    ],
  },
  accessControl: {
    title: 'Access Control',
    aliases: ['access control'],
    tasks: [
      ppm('Monthly', 'System Status', 'Review system alarms, controller faults, offline devices and reported access issues.', 'Investigate outstanding faults.', 'System/Fault Log'),
      ppm('Quarterly', 'Readers', 'Test operation of card/credential readers.', 'Investigate failed or intermittent readers.', 'Maintenance Record'),
      ppm('Quarterly', 'Doors', 'Check controlled doors operate and secure correctly.', 'Adjust or repair where required.', 'Maintenance Record'),
      ppm('Quarterly', 'Locks', 'Test electric locks, magnetic locks, strikes or other locking devices.', 'Confirm reliable locking and release.', 'Maintenance Record'),
      ppm('Quarterly', 'Request to Exit', 'Test request-to-exit devices and buttons.', 'Repair defective devices.', 'Maintenance Record'),
      ppm('Quarterly', 'Door Contacts', 'Test door position monitoring and associated alarms.', 'Adjust or replace contacts where required.', 'Maintenance Record'),
      ppm('Six Monthly', 'Emergency Release', 'Test emergency door release devices/break-glass units where applicable, following the agreed safe test procedure.', 'Record test and reinstate correctly.', 'Maintenance Record'),
      ppm('Six Monthly', 'Door Alarms', 'Test door forced, door held/open-too-long and other configured door alarms.', 'Confirm correct event/alarm generation.', 'Alarm Test Record'),
      ppm('Six Monthly', 'Controllers', 'Check access control panels/controllers for faults, communication issues and physical condition.', 'Investigate faults.', 'System Health Report'),
      ppm('Six Monthly', 'PSU/Batteries', 'Inspect power supplies and standby batteries. Test battery condition where appropriate.', 'Replace batteries showing deterioration or outside recommended service life.', 'PSU/Battery Record'),
      ppm('Six Monthly', 'Time Synchronisation', 'Check controllers and server/head-end time synchronisation.', 'Correct configuration where required.', 'Maintenance Record'),
      ppm('Annually', 'Full Functional Test', 'Complete functional test of the access control system.', 'Record defects and recommendations.', 'Annual Maintenance Report'),
      ppm('Annually', 'Permissions', 'Review access levels, schedules and system configuration with the authorised client representative where included within the maintenance scope.', 'Update only following client authorisation.', 'Configuration Record'),
      ppm('Annually', 'Documentation', 'Review door schedules, controller schedules and drawings against installed equipment.', 'Update records where required.', 'Updated Documentation'),
    ],
  },
  intruder: {
    title: 'Intruder Alarm',
    aliases: ['intruder', 'intruder alarm'],
    tasks: [
      ppm('Six Monthly', 'Control Equipment', 'Inspect control panels, expanders and associated equipment for correct operation and faults.', 'Rectify identified defects.', 'Maintenance Record'),
      ppm('Six Monthly', 'Detection Devices', 'Functionally test detectors including PIRs, dual-technology detectors, contacts and other detection devices.', 'Confirm correct alarm activation.', 'Test Record'),
      ppm('Six Monthly', 'Hold-Up Devices', 'Test hold-up/panic devices where installed, using agreed procedures and coordination with the ARC where applicable.', 'Confirm correct signalling.', 'Test Record'),
      ppm('Six Monthly', 'Warning Devices', 'Test internal and external audible/visual warning devices.', 'Repair defective devices.', 'Test Record'),
      ppm('Six Monthly', 'Signalling', 'Test alarm transmission to the ARC/monitoring centre where applicable and authorised.', 'Confirm correct alarm transmission and restoration.', 'Signalling Test Record'),
      ppm('Six Monthly', 'Tamper Monitoring', 'Test system tamper circuits and relevant device tampers.', 'Rectify defective monitoring.', 'Test Record'),
      ppm('Six Monthly', 'Power Supplies', 'Check mains supplies, system PSUs and charger operation.', 'Rectify faults.', 'Maintenance Record'),
      ppm('Six Monthly', 'Batteries', 'Check standby battery condition and capacity where appropriate.', 'Replace deteriorated batteries.', 'Battery Record'),
      ppm('Six Monthly', 'Event Log', 'Review system event log for recurring faults, communication failures or unusual system events.', 'Investigate recurring issues.', 'Event Log Review'),
      ppm('Annually', 'Full System Test', 'Complete full functional inspection and test of the intruder alarm system.', 'Record defects and recommendations.', 'Annual Maintenance Report'),
      ppm('Annually', 'Documentation', 'Check zone lists, device schedules and system documentation against installed equipment.', 'Update records where required.', 'Updated Documentation'),
    ],
  },
  intercom: {
    title: 'Intercom / Door Entry',
    aliases: ['intercom', 'door entry', 'intercom / door entry', 'door-entry'],
    tasks: [
      ppm('Quarterly', 'Call Stations', 'Test call buttons/stations for correct operation.', 'Repair defective devices.', 'Maintenance Record'),
      ppm('Quarterly', 'Audio', 'Check two-way speech and audio quality.', 'Adjust or repair poor audio.', 'Maintenance Record'),
      ppm('Quarterly', 'Video', 'Where video intercom is installed, check image quality and camera operation.', 'Clean/adjust/repair as required.', 'Maintenance Record'),
      ppm('Quarterly', 'Door Release', 'Test door release operation from relevant intercom stations.', 'Confirm correct and reliable release.', 'Maintenance Record'),
      ppm('Six Monthly', 'Handsets/Stations', 'Test internal handsets, answering stations or concierge stations.', 'Repair defective equipment.', 'Maintenance Record'),
      ppm('Six Monthly', 'Call Routing', 'Test configured call routing and forwarding.', 'Correct configuration faults.', 'Test Record'),
      ppm('Six Monthly', 'Network Communication', 'For IP systems, check device connectivity and communication with system servers/controllers.', 'Investigate offline devices.', 'System Health Record'),
      ppm('Six Monthly', 'PSU/Battery', 'Inspect associated power supplies and standby batteries where installed.', 'Replace deteriorated batteries.', 'PSU/Battery Record'),
      ppm('Annually', 'Full Functional Test', 'Test complete intercom/door-entry operation including call, answer, speech and release functions.', 'Record defects and recommendations.', 'Annual Maintenance Report'),
      ppm('Annually', 'Documentation', 'Review device schedules and configuration information against installed equipment.', 'Update where required.', 'Updated Documentation'),
    ],
  },
  networks: {
    title: 'Network / Security Network',
    aliases: ['networking', 'networks', 'network', 'network infrastructure', 'security network'],
    tasks: [
      ppm('Monthly', 'System Health', 'Review managed switches and network equipment for faults, offline devices and critical alerts where monitoring is available.', 'Investigate reported faults.', 'System Health Log'),
      ppm('Quarterly', 'Network Equipment', 'Inspect switches, routers and associated network hardware for correct operation.', 'Rectify identified faults.', 'Maintenance Record'),
      ppm('Quarterly', 'Physical Condition', 'Check network cabinets, equipment mounting and visible connections.', 'Secure or repair where required.', 'Maintenance Record'),
      ppm('Quarterly', 'Environmental', 'Check cabinet ventilation, fans and temperature where monitoring is available.', 'Investigate overheating or failed cooling.', 'Maintenance Record'),
      ppm('Six Monthly', 'Switch Ports', 'Review switch port status for errors, unexpected down links or abnormal conditions where managed switches are used.', 'Investigate significant errors.', 'Network Health Record'),
      ppm('Six Monthly', 'PoE', 'Check PoE utilisation, port status and available PoE budget where applicable.', 'Investigate overloaded or failed PoE ports.', 'Network Health Record'),
      ppm('Six Monthly', 'Uplinks', 'Check network uplinks and fibre links for reported errors or communication problems.', 'Investigate degraded links.', 'Network Health Record'),
      ppm('Six Monthly', 'UPS', 'Inspect UPS condition, alarms and battery status where installed.', 'Replace batteries where required.', 'UPS Record'),
      ppm('Six Monthly', 'Configuration Backup', 'Back up configuration of managed network devices where supported and included within the maintenance agreement.', 'Store securely in accordance with project/client requirements.', 'Configuration Backup'),
      ppm('Annually', 'Firmware Review', 'Review firmware/software versions against manufacturer-supported releases and known security requirements.', 'Upgrade only following assessment, backup and client approval.', 'Firmware Review'),
      ppm('Annually', 'Network Performance', 'Review network utilisation, errors and general system performance where monitoring functionality permits.', 'Record recommendations.', 'Annual Network Report'),
      ppm('Annually', 'Documentation', 'Review switch schedules, IP/device schedules, VLAN information and network topology drawings.', 'Update documentation following authorised changes.', 'Updated Documentation'),
    ],
  },
  fireAlarm: {
    title: 'Fire Alarm',
    aliases: ['fire', 'fire alarm'],
    disclaimer: FIRE_ALARM_DISCLAIMER,
    tasks: [
      ppm('Weekly', 'User Test', 'Operate a manual call point in accordance with the site\'s fire alarm testing procedure and confirm correct panel/alarm operation.', 'Normally undertaken by the responsible person/site team. Record results in the fire alarm logbook.', 'Fire Alarm Logbook'),
      ppm('Monthly', 'Standby Power', 'Where applicable, carry out user checks required by the relevant standard/manufacturer for standby power supplies and associated equipment.', 'Record defects.', 'Fire Alarm Logbook'),
      ppm('Periodic', 'Competent Person Inspection', 'Inspection and servicing by a competent fire alarm service organisation at the intervals required by the applicable standard and risk assessment.', 'Record inspection, tests, defects and recommendations.', 'Service Certificate'),
      ppm('Periodic', 'Control Panel', 'Inspect and test control and indicating equipment.', 'Record faults and remedial requirements.', 'Service Record'),
      ppm('Periodic', 'Detection', 'Test automatic fire detectors in accordance with the applicable servicing regime.', 'Confirm correct operation and identification.', 'Service Record'),
      ppm('Periodic', 'Manual Call Points', 'Functionally test manual call points in accordance with the applicable servicing regime.', 'Confirm correct operation and identification.', 'Service Record'),
      ppm('Periodic', 'Sounders/Visual Alarms', 'Test alarm warning devices.', 'Confirm correct operation.', 'Service Record'),
      ppm('Periodic', 'Interfaces', 'Test monitored interfaces and cause-and-effect functions included within the service scope.', 'Coordinate testing of connected systems where necessary.', 'Cause & Effect Test Record'),
      ppm('Periodic', 'Fault Monitoring', 'Test relevant fault monitoring functions.', 'Confirm correct indication at control equipment.', 'Service Record'),
      ppm('Periodic', 'Batteries', 'Inspect/test standby batteries and charging arrangements in accordance with applicable requirements.', 'Replace where required.', 'Battery Record'),
      ppm('Periodic', 'Remote Signalling', 'Test connection to ARC/fire alarm receiving centre where installed and authorised.', 'Coordinate tests before activation.', 'Signalling Test Record'),
      ppm('Annually', 'Documentation Review', 'Review zone plans, device information, logbook and relevant system records.', 'Update records following authorised system changes.', 'Updated Documentation'),
    ],
  },
};

function normalizeSystemName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function maintenancePlanKeyForSystemName(systemName: string): MaintenancePlanKey | null {
  const normalized = normalizeSystemName(systemName);
  if (!normalized) return null;
  for (const [key, template] of Object.entries(PLAN_TEMPLATES) as Array<[MaintenancePlanKey, PlanTemplate]>) {
    if (template.aliases.some(alias => normalized === alias || normalized.startsWith(`${alias} `))) {
      return key;
    }
  }
  return null;
}

export function maintenancePlanTitle(systemName: string): string {
  const key = maintenancePlanKeyForSystemName(systemName);
  return key ? PLAN_TEMPLATES[key].title : systemName;
}

export function maintenancePlanDisclaimer(systemName: string): string | undefined {
  const key = maintenancePlanKeyForSystemName(systemName);
  return key ? PLAN_TEMPLATES[key].disclaimer : undefined;
}

export function cloneDefaultTasks(systemName: string): MaintenanceTask[] {
  const key = maintenancePlanKeyForSystemName(systemName);
  if (!key) return [];
  return PLAN_TEMPLATES[key].tasks.map(task => ({
    ...task,
    id: taskId(key, task.frequency, task.activity),
    systemGenerated: true,
  }));
}

export function emptyMaintenancePlan(): MaintenancePlanDoc {
  return { version: 1, notes: '', tasks: [] };
}

export function createDefaultMaintenancePlan(systemName: string): MaintenancePlanDoc {
  return { version: 1, notes: '', tasks: cloneDefaultTasks(systemName) };
}

export function serializeMaintenancePlan(plan: MaintenancePlanDoc): string {
  return JSON.stringify(plan);
}

export function parseMaintenancePlan(raw: string | null | undefined): MaintenancePlanDoc | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MaintenancePlanDoc>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.tasks)) return null;
    return {
      version: 1,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      tasks: parsed.tasks
        .filter(task => task && typeof task === 'object')
        .map(task => ({
          id: typeof task.id === 'string' && task.id ? task.id : crypto.randomUUID(),
          frequency: typeof task.frequency === 'string' ? task.frequency : 'As Required',
          activity: typeof task.activity === 'string' ? task.activity : '',
          requirement: typeof task.requirement === 'string' ? task.requirement : '',
          evidence: typeof task.evidence === 'string' ? task.evidence : '',
          systemGenerated: Boolean(task.systemGenerated),
        })),
    };
  } catch {
    return null;
  }
}

export function hydrateStoredMaintenancePlan(
  systemName: string,
  raw: string | null | undefined,
  generatedBy?: string | null,
): { plan: MaintenancePlanDoc; converted: boolean } {
  const parsed = parseMaintenancePlan(raw);
  if (parsed) return { plan: parsed, converted: false };

  const trimmed = raw?.trim() ?? '';
  const looksAuto = generatedBy === 'auto' || !trimmed;
  if (looksAuto) {
    return { plan: createDefaultMaintenancePlan(systemName), converted: trimmed.length > 0 };
  }

  return {
    plan: {
      version: 1,
      notes: trimmed,
      tasks: cloneDefaultTasks(systemName),
    },
    converted: true,
  };
}

export function maintenancePlanHasContent(plan: MaintenancePlanDoc | undefined): boolean {
  if (!plan) return false;
  return plan.tasks.some(task => task.activity.trim() || task.requirement.trim()) || Boolean(plan.notes.trim());
}

export function newMaintenanceTask(): MaintenanceTask {
  return {
    id: crypto.randomUUID(),
    frequency: 'Quarterly',
    activity: '',
    requirement: '',
    evidence: 'Maintenance Record',
    systemGenerated: false,
  };
}

export function frequencySelectValue(frequency: string): MaintenanceFrequency | 'Custom' {
  return (MAINTENANCE_FREQUENCIES as readonly string[]).includes(frequency)
    ? (frequency as MaintenanceFrequency)
    : 'Custom';
}

import React, { useState, useEffect, useCallback } from 'react';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { CommissioningRecord, SYSTEM_TYPES } from '../types';
import type { Device } from '../types';
import {
  Plus, CheckCircle, XCircle, Circle, Save, Loader2,
} from 'lucide-react';

const DEFAULT_TEMPLATES: Record<string, { sections: string[]; items: Array<{ section: string; test_description: string; expected_result: string }> }> = {
  CCTV: {
    sections: ['Pre-Installation', 'Installation', 'Configuration', 'Testing'],
    items: [
      { section: 'Pre-Installation', test_description: 'Survey complete', expected_result: 'Site survey documented' },
      { section: 'Installation', test_description: 'Cable testing', expected_result: 'All cables tested and certified' },
      { section: 'Installation', test_description: 'Camera power-up', expected_result: 'All cameras powered and responding' },
      { section: 'Configuration', test_description: 'Image quality (each camera)', expected_result: 'Clear image at all light levels' },
      { section: 'Testing', test_description: 'Recording verification', expected_result: 'System recording continuously' },
      { section: 'Testing', test_description: 'Motion detection test', expected_result: 'Alerts generated correctly' },
      { section: 'Testing', test_description: 'Remote access test', expected_result: 'Remote viewing operational' },
      { section: 'Configuration', test_description: 'NVR backup verification', expected_result: 'Backup routine operational' },
      { section: 'Installation', test_description: 'Labels applied', expected_result: 'All cameras and equipment labeled' },
      { section: 'Configuration', test_description: 'Documentation complete', expected_result: 'Full system documentation provided' },
    ],
  },
  'Access Control': {
    sections: ['Pre-Installation', 'Installation', 'Configuration', 'Testing'],
    items: [
      { section: 'Pre-Installation', test_description: 'Site survey', expected_result: 'Survey completed and documented' },
      { section: 'Installation', test_description: 'Cable testing', expected_result: 'All cables tested' },
      { section: 'Installation', test_description: 'Controller power-up', expected_result: 'Controller operational' },
      { section: 'Configuration', test_description: 'Reader enrollment', expected_result: 'All readers commissioned' },
      { section: 'Testing', test_description: 'Card read test (each reader)', expected_result: 'Cards read successfully' },
      { section: 'Testing', test_description: 'Door lock/unlock test', expected_result: 'Doors lock and unlock correctly' },
      { section: 'Testing', test_description: 'REX test', expected_result: 'Request to exit working' },
      { section: 'Testing', test_description: 'Door held open alarm', expected_result: 'Alarm triggers on held door' },
      { section: 'Configuration', test_description: 'Time zone programming', expected_result: 'Time zones configured' },
      { section: 'Configuration', test_description: 'Access level programming', expected_result: 'Access levels assigned' },
      { section: 'Configuration', test_description: 'Fire/alarm integration', expected_result: 'Fire triggers configured' },
      { section: 'Configuration', test_description: 'System backup', expected_result: 'Backup operational' },
    ],
  },
  Intruder: {
    sections: ['Installation', 'Programming', 'Testing'],
    items: [
      { section: 'Installation', test_description: 'Panel installation', expected_result: 'Panel mounted and powered' },
      { section: 'Installation', test_description: 'Zone wiring', expected_result: 'All zones wired correctly' },
      { section: 'Installation', test_description: 'Detector installation', expected_result: 'All detectors mounted' },
      { section: 'Installation', test_description: 'Keypad installation', expected_result: 'Keypads installed and functional' },
      { section: 'Installation', test_description: 'Siren installation', expected_result: 'Siren mounted and tested' },
      { section: 'Programming', test_description: 'Zone programming', expected_result: 'All zones programmed' },
      { section: 'Programming', test_description: 'User code setup', expected_result: 'User codes assigned' },
      { section: 'Programming', test_description: 'Engineer code setup', expected_result: 'Engineer code set' },
      { section: 'Testing', test_description: 'Zone walk test', expected_result: 'All zones trigger correctly' },
      { section: 'Testing', test_description: 'Bell test', expected_result: 'Siren operates correctly' },
      { section: 'Testing', test_description: 'Remote signalling test', expected_result: 'Alarm transmits to ARC' },
      { section: 'Programming', test_description: 'Certificate of installation', expected_result: 'Certificate generated' },
    ],
  },
  Intercom: {
    sections: ['Installation', 'Configuration', 'Testing'],
    items: [
      { section: 'Installation', test_description: 'Master station install', expected_result: 'Master station mounted' },
      { section: 'Installation', test_description: 'Door station install', expected_result: 'Door stations installed' },
      { section: 'Installation', test_description: 'Cabling', expected_result: 'All cables installed' },
      { section: 'Installation', test_description: 'Power-up', expected_result: 'System powered and operational' },
      { section: 'Configuration', test_description: 'Address programming', expected_result: 'All units addressed' },
      { section: 'Testing', test_description: 'Call test', expected_result: 'Calls route correctly' },
      { section: 'Testing', test_description: 'Door release test', expected_result: 'Release functions correctly' },
      { section: 'Testing', test_description: 'Image quality', expected_result: 'Video quality acceptable' },
      { section: 'Testing', test_description: 'Audio quality', expected_result: 'Audio clear and operational' },
    ],
  },
  ANPR: {
    sections: ['Installation', 'Configuration', 'Testing'],
    items: [
      { section: 'Installation', test_description: 'Camera positioning', expected_result: 'Cameras at correct angle' },
      { section: 'Installation', test_description: 'IR illuminator alignment', expected_result: 'IR aligned with lens' },
      { section: 'Configuration', test_description: 'Image quality at day', expected_result: 'Clear daytime images' },
      { section: 'Configuration', test_description: 'Image quality at night', expected_result: 'Clear night images' },
      { section: 'Testing', test_description: 'Plate recognition test (enter/exit)', expected_result: 'Plates recognized correctly' },
      { section: 'Configuration', test_description: 'Whitelist programming', expected_result: 'Whitelist configured' },
      { section: 'Configuration', test_description: 'Barrier integration', expected_result: 'Barrier responds to events' },
      { section: 'Configuration', test_description: 'Software configuration', expected_result: 'Software parameters set' },
    ],
  },
  Perimeter: {
    sections: ['Installation', 'Configuration', 'Testing'],
    items: [
      { section: 'Installation', test_description: 'Detector positioning', expected_result: 'Detectors positioned correctly' },
      { section: 'Installation', test_description: 'Cable installation', expected_result: 'Cables installed and protected' },
      { section: 'Configuration', test_description: 'Zone configuration', expected_result: 'Zones configured' },
      { section: 'Testing', test_description: 'Tamper test', expected_result: 'Tamper alarm functions' },
      { section: 'Testing', test_description: 'Detection zone test', expected_result: 'Detection zone operational' },
      { section: 'Testing', test_description: 'False alarm analysis', expected_result: 'System operating correctly' },
      { section: 'Testing', test_description: 'Integration test', expected_result: 'System integrated correctly' },
    ],
  },
  Networking: {
    sections: ['Infrastructure', 'Configuration', 'Testing'],
    items: [
      { section: 'Infrastructure', test_description: 'Switch installation', expected_result: 'Switch mounted and powered' },
      { section: 'Infrastructure', test_description: 'Cable labelling', expected_result: 'All cables labeled' },
      { section: 'Configuration', test_description: 'VLAN configuration', expected_result: 'VLANs configured' },
      { section: 'Configuration', test_description: 'IP addressing scheme', expected_result: 'IP addressing documented' },
      { section: 'Configuration', test_description: 'Firewall rules', expected_result: 'Firewall configured' },
      { section: 'Configuration', test_description: 'Remote access VPN', expected_result: 'VPN operational' },
      { section: 'Testing', test_description: 'Bandwidth test', expected_result: 'Bandwidth sufficient' },
      { section: 'Testing', test_description: 'PoE verification', expected_result: 'PoE operational' },
      { section: 'Configuration', test_description: 'SNMP monitoring', expected_result: 'SNMP configured' },
      { section: 'Configuration', test_description: 'Documentation', expected_result: 'Documentation complete' },
    ],
  },
};

export default function CommissioningPage() {
  const { project } = useProject();
  const pid = project?.id;

  const [activeTab, setActiveTab] = useState<string>('CCTV');
  const [records, setRecords] = useState<CommissioningRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [engineerName, setEngineerName] = useState('');
  const [testDate, setTestDate] = useState(new Date().toISOString().split('T')[0]);
  const [signOffDialog, setSignOffDialog] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);

  const fetchRecords = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    const { data } = await supabase
      .from('commissioning_records')
      .select('*')
      .eq('project_id', pid)
      .eq('system_type', activeTab)
      .order('sort_order', { ascending: true });
    setRecords(data ?? []);
    setLoading(false);
  }, [pid, activeTab]);

  useEffect(() => {
    if (pid) {
      fetchRecords();
    }
  }, [pid, activeTab, fetchRecords]);

  useEffect(() => {
    if (!pid) return;
    supabase.from('devices').select('*').eq('project_id', pid).then(({ data: devs }) => {
      setDevices(devs ?? []);
    });
  }, [pid]);

  // Filter tabs to only show installed systems
  const installedSystems = [...new Set(devices.map(d => d.system_type).filter(Boolean))] as string[];
  const visibleTabs = SYSTEM_TYPES.filter(t => installedSystems.includes(t));

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab as any)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [installedSystems.join(',')]);

  const generateDefaultChecklist = async () => {
    if (!pid) return;
    if (records.length > 0 && !confirm('Records already exist. Reset to default?')) return;
    if (records.length > 0) {
      await supabase.from('commissioning_records').delete().in('id', records.map(r => r.id));
    }
    const template = DEFAULT_TEMPLATES[activeTab];
    if (!template) return;
    const toInsert = template.items.map((item, idx) => ({
      project_id: pid, system_type: activeTab, section: item.section,
      test_description: item.test_description, expected_result: item.expected_result,
      actual_result: '', pass: null, engineer_name: '', test_date: null, notes: '', sort_order: idx,
    }));
    await supabase.from('commissioning_records').insert(toInsert);
    await fetchRecords();
  };

  const updateRecord = async (id: string, updates: Partial<CommissioningRecord>) => {
    await supabase.from('commissioning_records').update(updates).eq('id', id);
    await fetchRecords();
  };

  const togglePass = (record: CommissioningRecord) => {
    const newPass = record.pass === null ? true : record.pass === true ? false : null;
    updateRecord(record.id as any, { pass: newPass });
  };

  const handleSignOff = async () => {
    if (!engineerName || !testDate) { alert('Please enter engineer name and date'); return; }
    for (const record of records) {
      await updateRecord(record.id as any, { engineer_name: engineerName, test_date: testDate });
    }
    setSignOffDialog(false);
    await fetchRecords();
  };

  const passCount = records.filter(r => r.pass === true).length;
  const failCount = records.filter(r => r.pass === false).length;
  const totalCount = records.length;
  const status = totalCount === 0 ? 'NO DATA' : passCount === totalCount ? 'PASS' : failCount > 0 ? 'FAIL' : 'IN PROGRESS';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">Commissioning</h2>
          <p className="text-sm text-slate-500 mt-0.5">System test checklists and commissioning records</p>
        </div>
        <span className={`text-sm font-bold px-3 py-1 rounded-full ${
          status === 'PASS' ? 'bg-emerald-100 text-emerald-700' : status === 'FAIL' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
        }`}>{status}</span>
      </div>

      {/* System tabs */}
      {visibleTabs.length > 0 ? (
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
          {visibleTabs.map(type => (
            <button key={type} onClick={() => setActiveTab(type)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === type ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {type}
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          No systems have been added to this project yet. Add devices to see commissioning checklists.
        </div>
      )}

      {visibleTabs.length > 0 && (
        <>
          {/* Checklist controls */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-slate-500 mb-1">Engineer</label>
                <input type="text" value={engineerName} onChange={e => setEngineerName(e.target.value)} placeholder="Engineer name" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div className="min-w-[160px]">
                <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                <input type="date" value={testDate} onChange={e => setTestDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div className="flex items-end gap-2">
                <button onClick={generateDefaultChecklist} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-700 transition-colors">
                  <Plus className="w-4 h-4" />Generate Checklist
                </button>
                {records.length > 0 && (
                  <button onClick={() => setSignOffDialog(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
                    <Save className="w-4 h-4" />Sign Off
                  </button>
                )}
              </div>
            </div>
            {totalCount > 0 && (
              <div className="mt-4 flex items-center gap-4 bg-slate-50 rounded-lg p-3">
                <span className="text-sm text-slate-600"><span className="font-semibold text-emerald-600">{passCount}</span> / {totalCount} passed</span>
                {failCount > 0 && <span className="text-sm text-red-600 font-medium">{failCount} failed</span>}
              </div>
            )}
          </div>

          {/* Checklist table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading...</span></div>
            ) : records.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">No records. Click "Generate Checklist" to begin.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Section</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Test</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Expected</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-44">Actual Result</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-36">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {records.map(record => (
                      <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <button onClick={() => togglePass(record)} className="p-1 rounded hover:bg-slate-200 transition-colors" title="Click to cycle: untested / pass / fail">
                            {record.pass === null && <Circle className="w-5 h-5 text-slate-300" />}
                            {record.pass === true && <CheckCircle className="w-5 h-5 text-emerald-600" />}
                            {record.pass === false && <XCircle className="w-5 h-5 text-red-500" />}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{record.section}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-800 font-medium">{record.test_description}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{record.expected_result}</td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text"
                            defaultValue={record.actual_result || ''}
                            onBlur={e => updateRecord(record.id as any, { actual_result: e.target.value })}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            placeholder="Result..."
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text"
                            defaultValue={record.notes || ''}
                            onBlur={e => updateRecord(record.id as any, { notes: e.target.value })}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            placeholder="Notes..."
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Sign-off dialog */}
      {signOffDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Sign Off Checklist</h3>
            <p className="text-sm text-slate-600">Assign all items to <strong>{engineerName || 'engineer'}</strong> with date <strong>{testDate}</strong>.</p>
            <div className="flex gap-3">
              <button onClick={() => setSignOffDialog(false)} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSignOff} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

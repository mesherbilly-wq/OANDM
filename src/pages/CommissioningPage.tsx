import React, { useState, useEffect, useCallback } from 'react';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { appendInspectionTitleItem } from '../components/safetyculture/safetyCultureFields';
import { CommissioningRecord, SYSTEM_TYPES } from '../types';
import type { Device, SCTemplateMapping } from '../types';
import {
  Plus, CheckCircle, XCircle, Circle, Save, Loader2,
  Shield, Download, Link2, ExternalLink, Upload, X,
} from 'lucide-react';

function scInspectionUrl(id: string): string {
  if (id.startsWith('audit_')) return `https://app.safetyculture.com/inspection/${id}`;
  if (id.startsWith('insp_')) return `https://app.safetyculture.com/inspection/audit_${id.slice(5)}`;
  return `https://app.safetyculture.com/inspection/audit_${id.replace(/-/g, '')}`;
}

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

type DocStatus = 'not_started' | 'in_progress' | 'completed' | 'imported' | 'uploaded';

interface HandoverDoc {
  id: number;
  document_type: string;
  title: string;
  status: DocStatus;
  sc_inspection_id: string | null;
  sc_inspection_name: string | null;
  sc_result: string | null;
  sc_engineer_name: string | null;
  sc_completion_date: string | null;
  file_url: string | null;
  file_name: string | null;
}

export default function CommissioningPage() {
  const { project } = useProject();
  const pid = project?.id;

  const [activeTab, setActiveTab] = useState<string>('CCTV');
  const [records, setRecords] = useState<CommissioningRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [engineerName, setEngineerName] = useState('');
  const [testDate, setTestDate] = useState(new Date().toISOString().split('T')[0]);
  const [signOffDialog, setSignOffDialog] = useState(false);

  // SC integration state
  const [scConnected, setScConnected] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [savedMappings, setSavedMappings] = useState<Record<string, SCTemplateMapping>>({});
  const [scDoc, setScDoc] = useState<HandoverDoc | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [importingDoc, setImportingDoc] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);

  const docType = `commissioning_${activeTab.toLowerCase().replace(/\s+/g, '_')}`;

  const invoke = async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('safetyculture-proxy', { body: { action, ...extra } });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

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

  const fetchScDoc = useCallback(async () => {
    if (!pid) return;
    const { data } = await supabase
      .from('project_handover_docs')
      .select('*')
      .eq('project_id', pid)
      .eq('document_type', docType)
      .maybeSingle();
    setScDoc(data as HandoverDoc | null);
  }, [pid, docType]);

  useEffect(() => {
    if (pid) {
      fetchRecords();
      fetchScDoc();
    }
  }, [pid, activeTab, fetchRecords, fetchScDoc]);

  useEffect(() => {
    Promise.all([
      supabase.from('integration_settings').select('value').eq('key', 'safetyculture_api_token').maybeSingle(),
      supabase.from('sc_template_mappings').select('*'),
      supabase.from('devices').select('*').eq('project_id', pid!),
    ]).then(([{ data: tok }, { data: maps }, { data: devs }]) => {
      setScConnected(!!tok?.value);
      const byTmpl: Record<string, SCTemplateMapping> = {};
      for (const m of maps ?? []) byTmpl[m.template_id] = m;
      setSavedMappings(byTmpl);
      setDevices(devs ?? []);
      if (tok?.value) {
        invoke('list_templates').then(d => setTemplates(d.templates ?? [])).catch(() => {});
      }
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

  // SC actions
  const buildInspectionName = () => {
    const name = project.project_name || project.job_number || 'Project';
    return `${name} - ${activeTab} Commissioning`;
  };

  const createFromSC = async () => {
    if (!selectedTemplateId || !pid) return;
    setActionLoading(true);
    try {
      const mapping = savedMappings[selectedTemplateId];
      const items: any[] = [];
      const fm = mapping?.field_mappings ?? {};
      const addText = (key: string, value: string | null | undefined) => {
        if (fm[key] && value) items.push({ item_id: fm[key], item_type: 'TEXT', text_item: { value } });
      };
      addText('job_number', project.job_number);
      addText('project_name', project.project_name);
      addText('client_name', project.client_name);
      addText('site_name', project.site_name);
      addText('site_address', project.site_address);
      addText('project_manager', project.project_manager);
      const inspName = buildInspectionName();
      appendInspectionTitleItem(items, inspName, fm);
      const d = await invoke('create_inspection', {
        template_id: selectedTemplateId,
        items,
        name: inspName,
        audit_title_item_id: fm.inspection_title || undefined,
      });
      await supabase.from('project_handover_docs').upsert({
        project_id: pid, document_type: docType, title: `${activeTab} Commissioning`,
        status: 'in_progress', sc_inspection_id: d.inspection_id,
        sc_template_id: selectedTemplateId, sc_inspection_name: inspName,
      }, { onConflict: 'project_id,document_type' });
      setShowCreateModal(false);
      await fetchScDoc();
    } catch (e: any) { alert('Failed: ' + e.message); }
    finally { setActionLoading(false); }
  };

  const importScResults = async () => {
    if (!scDoc?.sc_inspection_id || !pid) return;
    setImportingDoc(true);
    try {
      const d = await invoke('get_inspection', { inspection_id: scDoc.sc_inspection_id });
      const status: DocStatus = d.status === 'completed' || d.date_completed ? 'imported' : 'in_progress';
      await supabase.from('project_handover_docs').update({
        status, sc_result: d.result ?? null, sc_engineer_name: d.engineer_name ?? null,
        sc_completion_date: d.date_completed ?? null, sc_imported_at: status === 'imported' ? new Date().toISOString() : null,
      }).eq('id', scDoc.id);
      await fetchScDoc();
    } catch (e: any) { alert('Import failed: ' + e.message); }
    finally { setImportingDoc(false); }
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
          {/* SafetyCulture integration card */}
          {scConnected && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold text-slate-700">SafetyCulture Inspection</span>
                {scDoc && (
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full border ${
                    scDoc.status === 'imported' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    scDoc.status === 'in_progress' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {scDoc.status === 'imported' ? 'Imported' : scDoc.status === 'in_progress' ? 'In Progress' : scDoc.status}
                  </span>
                )}
              </div>
              <div className="px-5 py-3">
                {scDoc?.sc_inspection_id ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-slate-700 font-medium">{scDoc.sc_inspection_name}</span>
                    <a href={scInspectionUrl(scDoc.sc_inspection_id)} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline flex items-center gap-0.5">
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                    {scDoc.status !== 'imported' && (
                      <button onClick={importScResults} disabled={importingDoc} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
                        {importingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        Import Results
                      </button>
                    )}
                    {scDoc.sc_result && (
                      <span className={`text-xs font-medium ${scDoc.sc_result === 'pass' ? 'text-emerald-600' : 'text-red-600'}`}>
                        Result: {scDoc.sc_result}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setShowCreateModal(true); setSelectedTemplateId(''); }} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors">
                      <Plus className="w-3.5 h-3.5" />Create from SafetyCulture
                    </button>
                    <span className="text-xs text-slate-400">Create an inspection to track commissioning via SafetyCulture</span>
                  </div>
                )}
              </div>
            </div>
          )}

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

      {/* Create from SC modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Create Commissioning Inspection</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeTab}</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Select Template</label>
                <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500">
                  <option value="">Choose a template...</option>
                  {templates.map(t => {
                    const tid = t.template_id ?? t.id;
                    return <option key={tid} value={tid}>{t.name}{savedMappings[tid] ? ' (mapped)' : ''}</option>;
                  })}
                </select>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-700">Inspection name:</p>
                <p className="text-sm font-mono text-cyan-700 mt-0.5">{buildInspectionName()}</p>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={createFromSC} disabled={!selectedTemplateId || actionLoading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

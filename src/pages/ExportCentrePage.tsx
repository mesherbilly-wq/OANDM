import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { Device, CommissioningRecord, HandoverDocument } from '../types';
import {
  Download,
  Eye,
  FileText,
  BarChart3,
  Package,
  Printer,
  Calendar,
  Loader,
} from 'lucide-react';

interface ExportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface ProjectDocument {
  id: string;
  title: string;
  content?: string;
}

const generateCSV = (headers: string[], rows: any[][]): string => {
  const headerRow = headers.map((h) => `"${h}"`).join(',');
  const dataRows = rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
};

const downloadFile = (content: string, filename: string, mimeType: string = 'text/plain') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const recordExportTime = (projectId: string, type: string) => {
  const key = `export_${projectId}_${type}`;
  localStorage.setItem(key, new Date().toISOString());
};

const getLastExportTime = (projectId: string, type: string): string | null => {
  const key = `export_${projectId}_${type}`;
  const time = localStorage.getItem(key);
  return time ? new Date(time).toLocaleDateString() : null;
};

export default function ExportCentrePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { project } = useProject();
  const [devices, setDevices] = useState<Device[]>([]);
  const [commissioningRecords, setCommissioningRecords] = useState<CommissioningRecord[]>([]);
  const [handoverDocs, setHandoverDocs] = useState<HandoverDocument[]>([]);
  const [projectDocs, setProjectDocs] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [showProjectDocsModal, setShowProjectDocsModal] = useState(false);
  const [selectedProjectDocs, setSelectedProjectDocs] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchAllData();
    }
  }, [projectId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchAllData = async () => {
    if (!projectId) return;
    try {
      const [devicesRes, commRes, handoverRes, docsRes] = await Promise.all([
        supabase.from('devices').select('*').eq('project_id', projectId),
        supabase.from('commissioning_records').select('*').eq('project_id', projectId),
        supabase.from('handover_documents').select('*').eq('project_id', projectId),
        supabase.from('project_documents').select('*').eq('project_id', projectId),
      ]);

      if (devicesRes.data) setDevices(devicesRes.data);
      if (commRes.data) setCommissioningRecords(commRes.data);
      if (handoverRes.data) setHandoverDocs(handoverRes.data);
      if (docsRes.data) setProjectDocs(docsRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const exportDeviceSchedule = async () => {
    setLoading((prev) => ({ ...prev, device_schedule: true }));
    try {
      const headers = ['Device Name', 'System Type', 'Device Type', 'Manufacturer', 'Model Number', 'Location', 'IP Address', 'Status'];
      const rows = devices.map((d) => [
        d.device_name,
        d.system_type,
        d.device_type,
        d.manufacturer || '',
        d.model_number || '',
        d.location || '',
        d.ip_address || '',
        d.status || 'active',
      ]);

      const csv = generateCSV(headers, rows);
      downloadFile(csv, `device-schedule-${projectId}.csv`, 'text/csv');
      recordExportTime(projectId || '', 'device_schedule');
      setToast('Device Schedule downloaded successfully');
    } catch (err) {
      console.error('Error exporting device schedule:', err);
    } finally {
      setLoading((prev) => ({ ...prev, device_schedule: false }));
    }
  };

  const exportAssetRegister = async () => {
    setLoading((prev) => ({ ...prev, asset_register: true }));
    try {
      const approvedDevices = devices.filter((d) => d.status === 'approved');
      const headers = ['Device Name', 'Manufacturer', 'Model Number', 'Serial Number', 'IP Address', 'MAC Address', 'Firmware Version', 'Location', 'Notes'];
      const rows = approvedDevices.map((d) => [
        d.device_name,
        d.manufacturer || '',
        d.model_number || '',
        d.serial_number || '',
        d.ip_address || '',
        d.mac_address || '',
        d.firmware_version || '',
        d.location || '',
        d.notes || '',
      ]);

      const csv = generateCSV(headers, rows);
      downloadFile(csv, `asset-register-${projectId}.csv`, 'text/csv');
      recordExportTime(projectId || '', 'asset_register');
      setToast('Asset Register downloaded successfully');
    } catch (err) {
      console.error('Error exporting asset register:', err);
    } finally {
      setLoading((prev) => ({ ...prev, asset_register: false }));
    }
  };

  const exportTechnicalDocs = async () => {
    setLoading((prev) => ({ ...prev, technical_docs: true }));
    try {
      const headers = ['Device Name', 'IP Address', 'MAC Address', 'Firmware Version', 'Username Hint', 'Controller Address', 'VLAN', 'Network Zone'];
      const rows = devices.map((d) => [
        d.device_name,
        d.ip_address || '',
        d.mac_address || '',
        d.firmware_version || '',
        d.username_hint || '',
        d.controller_address || '',
        d.vlan || '',
        d.network_zone || '',
      ]);

      const csv = generateCSV(headers, rows);
      downloadFile(csv, `technical-documentation-${projectId}.csv`, 'text/csv');
      recordExportTime(projectId || '', 'technical_docs');
      setToast('Technical Documentation downloaded successfully');
    } catch (err) {
      console.error('Error exporting technical docs:', err);
    } finally {
      setLoading((prev) => ({ ...prev, technical_docs: false }));
    }
  };

  const exportCommissioningSummary = async () => {
    setLoading((prev) => ({ ...prev, commissioning_summary: true }));
    try {
      const headers = ['System Type', 'Section', 'Test Description', 'Expected Result', 'Actual Result', 'Pass', 'Engineer Name', 'Test Date', 'Notes'];
      const rows = commissioningRecords.map((r) => [
        r.system_type,
        r.section,
        r.test_description,
        r.expected_result,
        r.actual_result || '',
        r.pass === null ? 'Untested' : r.pass ? 'Pass' : 'Fail',
        r.engineer_name || '',
        r.test_date || '',
        r.notes || '',
      ]);

      const csv = generateCSV(headers, rows);
      downloadFile(csv, `commissioning-summary-${projectId}.csv`, 'text/csv');
      recordExportTime(projectId || '', 'commissioning_summary');
      setToast('Commissioning Summary downloaded successfully');
    } catch (err) {
      console.error('Error exporting commissioning summary:', err);
    } finally {
      setLoading((prev) => ({ ...prev, commissioning_summary: false }));
    }
  };

  const generateProjectReport = async () => {
    setLoading((prev) => ({ ...prev, project_report: true }));
    try {
      const systemCounts: Record<string, number> = {};
      devices.forEach((d) => {
        systemCounts[d.system_type] = (systemCounts[d.system_type] || 0) + 1;
      });

      const totalTests = commissioningRecords.length;
      const passedTests = commissioningRecords.filter((r) => r.pass === true).length;
      const failedTests = commissioningRecords.filter((r) => r.pass === false).length;
      const unTestedTests = commissioningRecords.filter((r) => r.pass === null).length;

      const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : '0.0';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Project Report - ${project?.name || 'Security Project'}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #ecf0f1; font-weight: bold; }
    .summary-box { background-color: #ecf0f1; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .pass { color: #27ae60; font-weight: bold; }
    .fail { color: #e74c3c; font-weight: bold; }
    .footer { margin-top: 50px; font-size: 12px; color: #7f8c8d; }
  </style>
</head>
<body>
  <h1>Security Project Lifecycle Platform</h1>
  <h1>Project Report</h1>

  <h2>Project Information</h2>
  <div class="summary-box">
    <p><strong>Project Name:</strong> ${project?.name || 'N/A'}</p>
    <p><strong>Project ID:</strong> ${projectId}</p>
    <p><strong>Report Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>

  <h2>Systems Summary</h2>
  <table>
    <tr>
      <th>System Type</th>
      <th>Device Count</th>
    </tr>
    ${Object.entries(systemCounts)
      .map(
        ([system, count]) => `
    <tr>
      <td>${system}</td>
      <td>${count}</td>
    </tr>
    `
      )
      .join('')}
  </table>

  <h2>Commissioning Status</h2>
  <div class="summary-box">
    <p><strong>Total Tests:</strong> ${totalTests}</p>
    <p><span class="pass">Passed: ${passedTests}</span></p>
    <p><span class="fail">Failed: ${failedTests}</span></p>
    <p><strong>Untested:</strong> ${unTestedTests}</p>
    <p><strong>Pass Rate:</strong> ${passRate}%</p>
  </div>

  <h2>Device Inventory</h2>
  <table>
    <tr>
      <th>Device Name</th>
      <th>System Type</th>
      <th>Device Type</th>
      <th>Manufacturer</th>
      <th>Status</th>
    </tr>
    ${devices
      .map(
        (d) => `
    <tr>
      <td>${d.device_name}</td>
      <td>${d.system_type}</td>
      <td>${d.device_type}</td>
      <td>${d.manufacturer || 'N/A'}</td>
      <td>${d.status || 'active'}</td>
    </tr>
    `
      )
      .join('')}
  </table>

  <div class="footer">
    <p>This report was automatically generated by the Security Project Lifecycle Platform.</p>
  </div>
</body>
</html>
      `;

      downloadFile(html, `project-report-${projectId}.html`, 'text/html');
      recordExportTime(projectId || '', 'project_report');
      setToast('Project Report downloaded successfully');
    } catch (err) {
      console.error('Error generating report:', err);
    } finally {
      setLoading((prev) => ({ ...prev, project_report: false }));
    }
  };

  const handlePrintHandover = () => {
    window.print();
  };

  const toggleProjectDocSelection = (docId: string) => {
    const updated = new Set(selectedProjectDocs);
    if (updated.has(docId)) {
      updated.delete(docId);
    } else {
      updated.add(docId);
    }
    setSelectedProjectDocs(updated);
  };

  const exportCards: ExportCard[] = [
    {
      id: 'device_schedule',
      title: 'Device Schedule (CSV)',
      description: 'Export all devices with system type, location, and status',
      icon: <FileText className="h-8 w-8" />,
    },
    {
      id: 'asset_register',
      title: 'Asset Register (CSV)',
      description: 'Export approved devices with technical specifications',
      icon: <Package className="h-8 w-8" />,
    },
    {
      id: 'technical_docs',
      title: 'Technical Documentation (CSV)',
      description: 'Export technical details including IP, MAC, firmware',
      icon: <FileText className="h-8 w-8" />,
    },
    {
      id: 'commissioning_summary',
      title: 'Commissioning Summary (CSV)',
      description: 'Export all commissioning test results and notes',
      icon: <BarChart3 className="h-8 w-8" />,
    },
    {
      id: 'handover_pack',
      title: 'Handover Pack',
      description: 'View and print all signed handover documents',
      icon: <Printer className="h-8 w-8" />,
    },
    {
      id: 'project_docs',
      title: 'Project Documents Pack',
      description: 'Select and view AI-generated project documents',
      icon: <FileText className="h-8 w-8" />,
    },
    {
      id: 'om_builder',
      title: 'O&M Summary',
      description: 'Access the O&M documentation builder',
      icon: <FileText className="h-8 w-8" />,
    },
    {
      id: 'project_report',
      title: 'Project Report',
      description: 'Generate comprehensive project summary as HTML',
      icon: <BarChart3 className="h-8 w-8" />,
    },
  ];

  const handleExportClick = async (cardId: string) => {
    switch (cardId) {
      case 'device_schedule':
        await exportDeviceSchedule();
        break;
      case 'asset_register':
        await exportAssetRegister();
        break;
      case 'technical_docs':
        await exportTechnicalDocs();
        break;
      case 'commissioning_summary':
        await exportCommissioningSummary();
        break;
      case 'handover_pack':
        setShowHandoverModal(true);
        break;
      case 'project_docs':
        setShowProjectDocsModal(true);
        break;
      case 'om_builder':
        window.location.href = `/projects/${projectId}/om-builder`;
        break;
      case 'project_report':
        await generateProjectReport();
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Export Centre</h1>
        <p className="text-gray-600 mb-8">Download project data in various formats</p>

        {/* Toast Notification */}
        {toast && (
          <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg">
            {toast}
          </div>
        )}

        {/* Export Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {exportCards.map((card) => {
            const isLoading = loading[card.id];
            const lastExport = getLastExportTime(projectId || '', card.id);

            return (
              <div key={card.id} className="bg-white rounded-lg shadow-sm p-6 flex flex-col hover:shadow-md transition-shadow">
                <div className="text-blue-600 mb-3">{card.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{card.title}</h3>
                <p className="text-sm text-gray-600 mb-4 flex-1">{card.description}</p>

                {lastExport && (
                  <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Last exported: {lastExport}
                  </p>
                )}

                <button
                  onClick={() => handleExportClick(card.id)}
                  disabled={isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Export
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Handover Pack Modal */}
        {showHandoverModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">Handover Documents</h2>

              {handoverDocs.filter((d) => d.status === 'signed').length === 0 ? (
                <p className="text-gray-600 mb-6">No signed handover documents available.</p>
              ) : (
                <div className="space-y-6 mb-6">
                  {handoverDocs
                    .filter((d) => d.status === 'signed')
                    .map((doc) => (
                      <div key={doc.id} className="border border-gray-200 rounded-lg p-4">
                        <h3 className="font-semibold text-lg mb-2">{doc.title}</h3>
                        <div className="text-sm text-gray-600 mb-3 whitespace-pre-wrap">
                          {doc.content}
                        </div>
                        {doc.signed_by && (
                          <p className="text-xs text-gray-500">
                            Signed by: {doc.signed_by} on{' '}
                            {doc.signed_at ? new Date(doc.signed_at).toLocaleDateString() : 'N/A'}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowHandoverModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handlePrintHandover}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Project Documents Modal */}
        {showProjectDocsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">Project Documents</h2>

              {projectDocs.length === 0 ? (
                <p className="text-gray-600 mb-6">No project documents available.</p>
              ) : (
                <div className="space-y-3 mb-6">
                  {projectDocs.map((doc) => (
                    <label key={doc.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedProjectDocs.has(doc.id)}
                        onChange={() => toggleProjectDocSelection(doc.id)}
                        className="w-4 h-4"
                      />
                      <span className="font-medium text-gray-900">{doc.title}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="space-y-4 mb-6">
                {Array.from(selectedProjectDocs).map((docId) => {
                  const doc = projectDocs.find((d) => d.id === docId);
                  return (
                    <div key={docId} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      <h3 className="font-semibold mb-2">{doc?.title}</h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{doc?.content}</p>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowProjectDocsModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  Print Selected
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

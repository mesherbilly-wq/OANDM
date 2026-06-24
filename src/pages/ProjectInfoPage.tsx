import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProject } from './ProjectLayout';
import { Trash2, Plus, Check, X } from 'lucide-react';
import { Project, ProjectTeamMember, ProjectRevision } from '../types';

const PROJECT_STATUSES = ['active', 'on-hold', 'completed', 'cancelled'];
const TEAM_ROLES = ['project_manager', 'engineer', 'surveyor', 'other'];

export default function ProjectInfoPage() {
  const { id } = useParams<{ id: string }>();
  const { project, refreshProject } = useProject();

  const [formData, setFormData] = useState<Partial<Project>>({});
  const [teamMembers, setTeamMembers] = useState<ProjectTeamMember[]>([]);
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [savedToast, setSavedToast] = useState(false);
  const [addingTeamMember, setAddingTeamMember] = useState(false);
  const [addingRevision, setAddingRevision] = useState(false);
  const [loading, setLoading] = useState(true);

  const [newTeamMember, setNewTeamMember] = useState({
    role: 'engineer',
    name: '',
    email: '',
    phone: '',
  });

  const [newRevision, setNewRevision] = useState({
    revision_number: '',
    description: '',
    revised_by: '',
    revised_at: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (project) {
      setFormData(project);
      fetchTeamMembers();
      fetchRevisions();
    }
  }, [project, id]);

  const fetchTeamMembers = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('project_team')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error fetching team members:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRevisions = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('project_revisions')
        .select('*')
        .eq('project_id', id)
        .order('revision_number', { ascending: false });

      if (error) throw error;
      setRevisions(data || []);
    } catch (err) {
      console.error('Error fetching revisions:', err);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSaveProject = async () => {
    if (!id) return;
    try {
      const { error } = await supabase
        .from('projects')
        .update(formData)
        .eq('id', id);

      if (error) throw error;

      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
      refreshProject();
    } catch (err) {
      console.error('Error saving project:', err);
    }
  };

  const handleAddTeamMember = async () => {
    if (!id || !newTeamMember.name || !newTeamMember.email) return;

    try {
      const { error } = await supabase.from('project_team').insert([
        {
          project_id: id,
          role: newTeamMember.role,
          name: newTeamMember.name,
          email: newTeamMember.email,
          phone: newTeamMember.phone,
        },
      ]);

      if (error) throw error;

      setNewTeamMember({
        role: 'engineer',
        name: '',
        email: '',
        phone: '',
      });
      setAddingTeamMember(false);
      fetchTeamMembers();
    } catch (err) {
      console.error('Error adding team member:', err);
    }
  };

  const handleDeleteTeamMember = async (memberId: string) => {
    try {
      const { error } = await supabase
        .from('project_team')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      fetchTeamMembers();
    } catch (err) {
      console.error('Error deleting team member:', err);
    }
  };

  const handleAddRevision = async () => {
    if (!id || !newRevision.revision_number || !newRevision.description) return;

    try {
      const { error } = await supabase.from('project_revisions').insert([
        {
          project_id: id,
          revision_number: parseInt(newRevision.revision_number),
          description: newRevision.description,
          revised_by: newRevision.revised_by,
          revised_at: newRevision.revised_at,
        },
      ]);

      if (error) throw error;

      setNewRevision({
        revision_number: '',
        description: '',
        revised_by: '',
        revised_at: new Date().toISOString().split('T')[0],
      });
      setAddingRevision(false);
      fetchRevisions();
    } catch (err) {
      console.error('Error adding revision:', err);
    }
  };

  const handleDeleteRevision = async (revisionId: string) => {
    try {
      const { error } = await supabase
        .from('project_revisions')
        .delete()
        .eq('id', revisionId);

      if (error) throw error;
      fetchRevisions();
    } catch (err) {
      console.error('Error deleting revision:', err);
    }
  };

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Toast */}
      {savedToast && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg animate-fade-in-out">
          Saved
        </div>
      )}

      {/* Section 1: Project Details */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Project Details</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Job Number <span className="text-xs text-slate-400 font-normal ml-1">— used in SafetyCulture inspection names</span>
            </label>
            <input
              type="text"
              name="job_number"
              value={formData.job_number || ''}
              onChange={handleInputChange}
              placeholder="e.g. NCP104"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent font-mono text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project Name
            </label>
            <input
              type="text"
              name="project_name"
              value={formData.project_name || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Client Name
            </label>
            <input
              type="text"
              name="client_name"
              value={formData.client_name || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Site Name
            </label>
            <input
              type="text"
              name="site_name"
              value={formData.site_name || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Site Address
            </label>
            <input
              type="text"
              name="site_address"
              value={formData.site_address || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quote Number
            </label>
            <input
              type="text"
              name="quote_number"
              value={formData.quote_number || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project Manager
            </label>
            <input
              type="text"
              name="project_manager"
              value={formData.project_manager || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Start Date
            </label>
            <input
              type="date"
              name="start_date"
              value={formData.start_date || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Completion Date
            </label>
            <input
              type="date"
              name="completion_date"
              value={formData.completion_date || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project Status
            </label>
            <select
              name="project_status"
              value={formData.project_status || ''}
              onChange={handleInputChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
            >
              <option value="">Select status</option>
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Project Notes
          </label>
          <textarea
            name="project_notes"
            value={formData.project_notes || ''}
            onChange={handleInputChange}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
          />
        </div>

        <button
          onClick={handleSaveProject}
          className="mt-6 bg-cyan-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-cyan-700 transition"
        >
          Save
        </button>
      </div>

      {/* Section 2: Project Team */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Project Team</h2>
          <button
            onClick={() => setAddingTeamMember(true)}
            className="flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-cyan-700 transition"
          >
            <Plus size={16} />
            Add Team Member
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Role
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Name
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Email
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Phone
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => (
                <tr key={member.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 capitalize">
                    {member.role.replace('_', ' ')}
                  </td>
                  <td className="py-3 px-4 text-gray-900">{member.name}</td>
                  <td className="py-3 px-4 text-gray-700">{member.email}</td>
                  <td className="py-3 px-4 text-gray-700">{member.phone}</td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleDeleteTeamMember(member.id)}
                      className="text-red-600 hover:text-red-800 transition"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {addingTeamMember && (
          <div className="mt-6 border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role
                </label>
                <select
                  value={newTeamMember.role}
                  onChange={(e) =>
                    setNewTeamMember({ ...newTeamMember, role: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                >
                  {TEAM_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={newTeamMember.name}
                  onChange={(e) =>
                    setNewTeamMember({ ...newTeamMember, name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={newTeamMember.email}
                  onChange={(e) =>
                    setNewTeamMember({ ...newTeamMember, email: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={newTeamMember.phone}
                  onChange={(e) =>
                    setNewTeamMember({ ...newTeamMember, phone: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddTeamMember}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition"
              >
                <Check size={16} />
                Save
              </button>
              <button
                onClick={() => setAddingTeamMember(false)}
                className="flex items-center gap-2 bg-gray-400 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-500 transition"
              >
                <X size={16} />
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Revision History */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Revision History</h2>
          <button
            onClick={() => setAddingRevision(true)}
            className="flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-cyan-700 transition"
          >
            <Plus size={16} />
            Add Revision
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Rev No.
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Description
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Revised By
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Date
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 font-medium">
                    {revision.revision_number}
                  </td>
                  <td className="py-3 px-4 text-gray-900">{revision.description}</td>
                  <td className="py-3 px-4 text-gray-700">{revision.revised_by}</td>
                  <td className="py-3 px-4 text-gray-700">
                    {new Date(revision.revised_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleDeleteRevision(revision.id)}
                      className="text-red-600 hover:text-red-800 transition"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {addingRevision && (
          <div className="mt-6 border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Revision Number
                </label>
                <input
                  type="number"
                  value={newRevision.revision_number}
                  onChange={(e) =>
                    setNewRevision({
                      ...newRevision,
                      revision_number: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  value={newRevision.revised_at}
                  onChange={(e) =>
                    setNewRevision({ ...newRevision, revised_at: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <input
                  type="text"
                  value={newRevision.description}
                  onChange={(e) =>
                    setNewRevision({ ...newRevision, description: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Revised By
                </label>
                <input
                  type="text"
                  value={newRevision.revised_by}
                  onChange={(e) =>
                    setNewRevision({ ...newRevision, revised_by: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddRevision}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition"
              >
                <Check size={16} />
                Save
              </button>
              <button
                onClick={() => setAddingRevision(false)}
                className="flex items-center gap-2 bg-gray-400 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-500 transition"
              >
                <X size={16} />
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

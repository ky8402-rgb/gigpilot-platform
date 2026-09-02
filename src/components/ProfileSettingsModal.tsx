import React, { useState } from 'react';
import { 
  X, 
  User, 
  Key, 
  DollarSign, 
  Code, 
  Save, 
  Check, 
  ShieldCheck, 
  Globe, 
  Plus, 
  Trash2,
  Download,
  Database
} from 'lucide-react';
import { FreelancerProfile, AutopilotRules } from '../types';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: FreelancerProfile;
  onSaveProfile: (profile: FreelancerProfile) => void;
  rules: AutopilotRules;
  onSaveRules: (rules: Partial<AutopilotRules>) => void;
  onDownloadBackup?: () => void;
}

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  isOpen,
  onClose,
  profile,
  onSaveProfile,
  rules,
  onSaveRules,
  onDownloadBackup
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'api' | 'autopilot'>('profile');
  const [formData, setFormData] = useState<FreelancerProfile>({ ...profile });
  const [newSkill, setNewSkill] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkill.trim()) return;
    if (!formData.skills.includes(newSkill.trim())) {
      setFormData({
        ...formData,
        skills: [...formData.skills, newSkill.trim()]
      });
    }
    setNewSkill('');
  };

  const handleRemoveSkill = (skill: string) => {
    setFormData({
      ...formData,
      skills: formData.skills.filter(s => s !== skill)
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(formData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Freelancer Profile & API Connectors</h2>
              <p className="text-xs text-slate-400">Configure credentials, target rates, and automated bidding persona</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2 space-x-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-2.5 transition-all border-b-2 ${
              activeTab === 'profile'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Freelancer Persona & Bio
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`pb-2.5 transition-all border-b-2 ${
              activeTab === 'api'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Remote OK & Stream Preferences
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'profile' ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-300">Full Name / Agency Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">Hourly Rate Target ($/hr)</label>
                  <div className="relative mt-1">
                    <DollarSign className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      value={formData.hourlyRate}
                      onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-8 pr-3 text-xs text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                      required
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Professional Title / Headline</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Bio / Core Value Proposition</label>
                <textarea
                  rows={3}
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Core Skills & Tech Stack</label>
                <div className="mt-1.5 flex space-x-2">
                  <input
                    type="text"
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    placeholder="Add skill (e.g. Next.js, FastAPI, LangChain)..."
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddSkill}
                    className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Add
                  </button>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {formData.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center rounded-lg bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-300"
                    >
                      {skill}
                      <button
                        type="button"
                        onClick={() => handleRemoveSkill(skill)}
                        className="ml-1.5 text-emerald-400 hover:text-emerald-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl bg-emerald-950/20 border border-emerald-500/20 p-3.5 text-emerald-300">
                <ShieldCheck className="inline h-4 w-4 mr-1.5" />
                Zero API Keys Required • Remote OK, We Work Remotely, and Public Feeds operate without login, tokens, or credential barriers.
              </div>

              <div>
                <label className="font-semibold text-slate-300">Target Monthly Remote Income ($ USD)</label>
                <div className="relative mt-1">
                  <DollarSign className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    value={formData.targetMonthlyIncome || 3000}
                    onChange={(e) => setFormData({ ...formData, targetMonthlyIncome: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-8 pr-3 text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <span className="text-[11px] text-slate-500">KundanVision 369 will prioritize high-yield gigs that match this rate.</span>
              </div>

              <div>
                <label className="font-semibold text-slate-300">Primary Remote Niches</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {['React & Frontend', 'Python & AI Bots', 'Node.js & Backend', 'UI/UX Design', 'Full-Stack Web3'].map(cat => (
                    <span key={cat} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-medium text-xs">
                      ✓ {cat}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer Save */}
          <div className="flex flex-wrap items-center justify-between border-t border-slate-800 pt-4 gap-2">
            {savedSuccess ? (
              <span className="flex items-center text-xs font-bold text-emerald-400">
                <Check className="mr-1.5 h-4 w-4" />
                Settings Updated Successfully!
              </span>
            ) : onDownloadBackup ? (
              <button
                type="button"
                onClick={onDownloadBackup}
                className="flex items-center space-x-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                title="Export Work Orders & Transactions as JSON"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                <span>Download Backup (JSON)</span>
              </button>
            ) : <span />}

            <div className="flex space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center space-x-1.5 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Profile</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { 
  X, 
  Scale, 
  FileCheck, 
  Printer, 
  Copy, 
  Check, 
  Download, 
  ShieldCheck, 
  Calendar, 
  DollarSign, 
  CheckCircle2, 
  User, 
  Briefcase, 
  ExternalLink,
  Lock,
  Clock,
  AlertCircle
} from 'lucide-react';
import { ActiveContract } from '../types';

interface ContractAgreementModalProps {
  isOpen: boolean;
  onClose: () => void;
  contract?: ActiveContract | null;
  onSignContract?: (contractId: string, signerName: string) => void;
}

export const ContractAgreementModal: React.FC<ContractAgreementModalProps> = ({
  isOpen,
  onClose,
  contract,
  onSignContract
}) => {
  const [copied, setCopied] = useState(false);
  const [clientSignerName, setClientSignerName] = useState(contract?.clientName || 'Authorized Client Representative');
  const [isClientSigned, setIsClientSigned] = useState(true);
  const [signedTimestamp, setSignedTimestamp] = useState<string>('2026-09-01T14:22:10 UTC');

  if (!isOpen) return null;

  // Fallback defaults if opened without a specific contract
  const jobTitle = contract?.jobTitle || 'Master Enterprise Software Development & Autonomous AI Systems';
  const clientName = contract?.clientName || 'Client Organization / Enterprise Partner';
  const platform = contract?.platform || 'Direct Enterprise / RemoteOK';
  const contractId = contract?.id || 'CON-2026-8821';
  const agreementRef = `MSA-${contractId}`;
  const totalValue = contract?.totalValue || 2400;
  const startedDate = contract?.startedDate || 'September 01, 2026';
  const milestones = contract?.milestones && contract.milestones.length > 0 ? contract.milestones : [
    { id: 'M1', title: 'Phase 1: Architecture Blueprint, Headless Daemons & Core Engine', amount: Math.round(totalValue * 0.5), completed: true, dueDate: 'Week 1' },
    { id: 'M2', title: 'Phase 2: Gemini LLM Integration, Database Migrations & API Suite', amount: Math.round(totalValue * 0.35), completed: false, dueDate: 'Week 2' },
    { id: 'M3', title: 'Phase 3: Production Hardening, CI/CD Deployment & Final Handover', amount: Math.round(totalValue * 0.15), completed: false, dueDate: 'Week 3' }
  ];

  const handlePrint = () => {
    window.print();
  };

  const generateContractPlainText = () => {
    return `================================================================================
INDEPENDENT CONTRACTOR MASTER SERVICES AGREEMENT & STATEMENT OF WORK (SOW)
Document Reference: ${agreementRef}
Execution Date: ${startedDate}
Platform / Escrow Framework: ${platform}
================================================================================

1. PARTIES
CONTRACTOR / SERVICE PROVIDER:
Kundan Kumar (Kundan Vision AI Technologies)
Title: Principal Full-Stack Developer & Autonomous Automation Architect
Email: ky8402@gmail.com
Banking Remittance: Federal Bank (A/C: 99980119788763 | IFSC: FDRL0001447)
UPI ID: chandimay@ybl | PayPal: paypal.me/ky8402

CLIENT / RETAINING PARTY:
Name: ${clientName}
Designation: Authorized Principal Client
Engagement Platform: ${platform}

--------------------------------------------------------------------------------
2. STATEMENT OF WORK (SOW) & PROJECT SCOPE
Project Name: ${jobTitle}
Description of Services:
Contractor agrees to provide custom software engineering, automated workflow development,
AI pipeline integration (Google Gemini / LLMs), database schema synchronization, testing,
and cloud deployment services in accordance with milestone deliverables.

--------------------------------------------------------------------------------
3. MILESTONES & FINANCIAL CONSIDERATION
Total Contract Value: $${totalValue.toLocaleString()} USD
Milestone Breakdown:
${milestones.map((m, i) => `  ${i + 1}. [${m.id}] ${m.title} - $${m.amount.toLocaleString()} USD (Due: ${m.dueDate}) [${m.completed ? 'COMPLETED / ESCROW RELEASED' : 'PENDING'}]`).join('\n')}

Payment Terms:
All milestones shall be funded in platform escrow or remitted within 5 business days
of milestone submission. Payments remitted via Bank Transfer, PayPal REST Gateway, or Escrow.

--------------------------------------------------------------------------------
4. INTELLECTUAL PROPERTY & WORK MADE FOR HIRE
Upon receipt of full and complete payment for each deliverable, Contractor irrevocably
assigns to Client all right, title, and interest, including copyrights and trade secrets,
in the custom source code and assets created specifically for Client under this Agreement.
Contractor retains ownership of pre-existing tools, open-source libraries, and background framework.

--------------------------------------------------------------------------------
5. CONFIDENTIALITY & NON-DISCLOSURE (NDA)
Both parties agree to hold in strict confidence all proprietary technical data, credentials,
API keys, trade secrets, and business communications. Neither party shall disclose or use
Confidential Information without prior written authorization.

--------------------------------------------------------------------------------
6. ACCEPTANCE PERIOD & 30-DAY DEFECT WARRANTY
Client shall have fourteen (14) calendar days following deliverable submission to inspect
and test the milestone. Contractor warrants that for thirty (30) days post-delivery, Contractor
shall promptly rectify any reproducible critical software defects at zero additional charge.

--------------------------------------------------------------------------------
7. INDEPENDENT CONTRACTOR STATUS
Contractor is an independent contractor, not an employee, agent, or legal partner of Client.
Contractor maintains full autonomy over execution methods and is responsible for all applicable
taxes and statutory compliance (GST SAC 998315).

--------------------------------------------------------------------------------
8. GOVERNING LAW & DISPUTE RESOLUTION
This Agreement is governed by standard commercial contract law and the Indian Contract Act, 1872 /
International Commercial Arbitration under UNCITRAL rules. Disputes will be settled via binding arbitration.

--------------------------------------------------------------------------------
9. SIGNATURES & ELECTRONIC EXECUTION

CONTRACTOR:
Signature: /s/ Kundan Kumar
Name: Kundan Kumar
Title: Principal Full-Stack Developer
Timestamp: ${startedDate} 10:00:00 UTC
Digital Verification: SHA256: 7e89ab01ff94d48a31c8e02d8479e3fa910d54

CLIENT:
Signature: /s/ ${clientSignerName}
Name: ${clientSignerName}
Title: Authorized Client Representative
Timestamp: ${signedTimestamp}
Digital Verification: VERIFIED & LEGALLY EXECUTED
================================================================================`;
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(generateContractPlainText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([generateContractPlainText()], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${agreementRef}_Contract_Agreement.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleSignAgreement = () => {
    setIsClientSigned(true);
    const nowStamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    setSignedTimestamp(nowStamp);
    if (contract && onSignContract) {
      onSignContract(contract.id, clientSignerName);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto">
        
        {/* Top Control Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 sm:px-6 py-3.5 print:hidden">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-400 border border-emerald-500/30">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Independent Contractor Master Services Agreement
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 rounded bg-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 font-mono font-bold border border-emerald-500/30">
                  <ShieldCheck className="w-3 h-3" /> LEGALLY BINDING SOW
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Ref: <span className="text-emerald-400">{agreementRef}</span> • Platform: <span className="text-slate-300">{platform}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              title="Print formal contract or Save as PDF"
              className="rounded-lg border border-slate-800 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Print / Save PDF</span>
            </button>

            <button
              onClick={handleCopyText}
              title="Copy complete legal contract text"
              className="rounded-lg border border-slate-800 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy Text'}</span>
            </button>

            <button
              onClick={handleDownload}
              title="Download Contract as Text File"
              className="rounded-lg border border-slate-800 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-all ml-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Formal Contract Sheet */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8 bg-slate-900 text-slate-300 text-xs sm:text-sm leading-relaxed space-y-6 print:bg-white print:text-black print:p-0">
          
          {/* Official Document Banner */}
          <div className="rounded-2xl border border-emerald-500/20 bg-slate-950 p-6 shadow-inner text-center space-y-2 relative overflow-hidden print:border-black print:bg-white">
            <div className="text-[11px] font-mono tracking-widest text-emerald-400 font-bold uppercase">
              Formal Commercial Contract &amp; Binding Statement of Work
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight uppercase print:text-black">
              Independent Contractor Master Services Agreement
            </h1>
            <p className="text-xs text-slate-400 max-w-2xl mx-auto print:text-slate-600">
              Entered into pursuant to international commercial contracting principles, standard master services agreement terms, and the Statement of Work incorporated herein.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-[11px] font-mono text-slate-300">
              <span className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                Agreement Ref: <strong className="text-white">{agreementRef}</strong>
              </span>
              <span className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                Effective Date: <strong className="text-white">{startedDate}</strong>
              </span>
              <span className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                Total Consideration: <strong className="text-emerald-400">${totalValue.toLocaleString()} USD</strong>
              </span>
            </div>
          </div>

          {/* Parties Box */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contractor */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 print:border-gray-300 print:bg-white">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider border-b border-slate-800 pb-2">
                <span className="flex items-center gap-1 text-emerald-400">
                  <User className="w-3.5 h-3.5" /> Contractor / Developer
                </span>
                <span className="text-emerald-400 font-mono text-[10px]">VERIFIED PROVIDER</span>
              </div>
              <div className="text-sm font-bold text-white print:text-black">Kundan Kumar</div>
              <div className="text-xs text-slate-300">Kundan Vision AI Technologies</div>
              <div className="text-[11px] text-slate-400 space-y-0.5">
                <div>Principal Full-Stack Developer &amp; Autonomous Systems Architect</div>
                <div>Email: <span className="font-mono text-slate-200">ky8402@gmail.com</span></div>
                <div>PAN / GSTIN: <span className="font-mono text-slate-300">27AABCK3690F1Z9 (SAC 998315)</span></div>
                <div>Remittance: Federal Bank (A/C: 99980119788763 | IFSC: FDRL0001447)</div>
                <div>UPI ID: <span className="font-mono text-emerald-400">chandimay@ybl</span> | PayPal: <span className="font-mono text-cyan-400">ky8402</span></div>
              </div>
            </div>

            {/* Client */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 print:border-gray-300 print:bg-white">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider border-b border-slate-800 pb-2">
                <span className="flex items-center gap-1 text-indigo-400">
                  <Briefcase className="w-3.5 h-3.5" /> Client / Principal
                </span>
                <span className="text-indigo-400 font-mono text-[10px]">AUTHORIZED CLIENT</span>
              </div>
              <div className="text-sm font-bold text-white print:text-black">{clientName}</div>
              <div className="text-xs text-slate-300">Direct Principal Client</div>
              <div className="text-[11px] text-slate-400 space-y-0.5">
                <div>Designated Engagement Channel: <span className="font-semibold text-slate-200">{platform} Escrow</span></div>
                <div>Contract Target: <span className="text-slate-200">{jobTitle}</span></div>
                <div>Billing Currency: <span className="font-mono text-emerald-400 font-bold">USD ($ United States Dollars)</span></div>
                <div>Authorized Signatory: <span className="text-slate-200 font-semibold">{clientSignerName}</span></div>
              </div>
            </div>
          </div>

          {/* Legal Articles */}
          <div className="space-y-5 print:space-y-4">
            
            {/* Preamble */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed print:bg-transparent print:border-none">
              <strong className="text-slate-200">PREAMBLE &amp; RECITALS:</strong> This Independent Contractor Master Services Agreement and Statement of Work (collectively, the &ldquo;Agreement&rdquo;) is entered into as of the Effective Date by and between Kundan Kumar / Kundan Vision AI Technologies (&ldquo;Contractor&rdquo;) and {clientName} (&ldquo;Client&rdquo;). WHEREAS, Client desires to retain Contractor to perform the software development, engineering, and technical services described herein, and Contractor agrees to perform such services under the terms and conditions set forth below. NOW, THEREFORE, in consideration of the mutual covenants and promises herein contained, the parties agree as follows:
            </div>

            {/* Section 1: SOW */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">1</span>
                Statement of Work (SOW) &amp; Scope of Services
              </h3>
              <p className="text-slate-300">
                Contractor shall provide dedicated professional software engineering services to deliver the following project scope: <strong className="text-white">{jobTitle}</strong>.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1 text-xs">
                <li><strong className="text-slate-200">Architecture &amp; Implementation:</strong> Creation, optimization, and testing of full-stack application code, database schema migrations, and secure API integrations.</li>
                <li><strong className="text-slate-200">Milestone Deliverables:</strong> Timely fulfillment of each agreed milestone specification according to the delivery schedule in Section 2.</li>
                <li><strong className="text-slate-200">Change Management:</strong> Any material scope additions or modifications requested by Client shall be documented in an amended Statement of Work with adjusted milestone compensation and delivery timelines.</li>
              </ul>
            </div>

            {/* Section 2: Milestones & Compensation Schedule */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">2</span>
                Milestone Schedule, Compensation &amp; Escrow Settlement
              </h3>
              <p className="text-slate-300">
                Client agrees to pay Contractor a total fixed consideration of <strong className="text-emerald-400 font-mono font-bold">${totalValue.toLocaleString()} USD</strong>, payable in accordance with the following milestone delivery schedule:
              </p>

              {/* Milestone Breakdown Table */}
              <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950 print:border-gray-300 print:bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-800 print:bg-gray-100 print:text-black">
                    <tr>
                      <th className="py-2.5 px-3">Milestone / Scope Description</th>
                      <th className="py-2.5 px-3">Timeline</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-right">Amount (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-slate-300 print:divide-gray-200">
                    {milestones.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-3 font-sans font-medium text-slate-100 print:text-black">{m.title}</td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">{m.dueDate}</td>
                        <td className="py-2.5 px-3 text-center">
                          {m.completed ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 text-emerald-400 px-2 py-0.5 text-[10px] font-bold font-sans">
                              <Check className="w-3 h-3" /> Escrow Released
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 text-amber-300 px-2 py-0.5 text-[10px] font-medium font-sans">
                              <Clock className="w-3 h-3" /> In Progress
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-white print:text-black">
                          ${m.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-900/80 font-bold print:bg-gray-50">
                      <td colSpan={3} className="py-2.5 px-3 text-right text-slate-300 font-sans uppercase text-[11px]">Total Contract Consideration:</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400 font-mono text-sm">${totalValue.toLocaleString()} USD</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-slate-400">
                Payment Terms: Each milestone payment is either pre-funded into verified escrow ({platform}) or remitted within five (5) business days of deliverable submission via Direct Federal Bank Remittance (A/C: 99980119788763 / IFSC: FDRL0001447), UPI (chandimay@ybl), or PayPal REST Gateway (paypal.me/ky8402).
              </p>
            </div>

            {/* Section 3: Intellectual Property */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">3</span>
                Intellectual Property Rights &amp; Work Made for Hire
              </h3>
              <p className="text-slate-300">
                <strong className="text-slate-100">Assignment of Deliverables:</strong> Conditioned strictly upon Contractor&rsquo;s receipt of full and final payment for the corresponding milestone, Contractor hereby assigns to Client all right, title, and interest, including all copyright, patent, and trade secret rights, in and to the custom deliverables, source code, and documentation authored specifically for Client under this Agreement.
              </p>
              <p className="text-slate-300 text-xs">
                <strong className="text-slate-100">Background IP &amp; Tooling Reservation:</strong> Contractor retains sole ownership of Contractor&rsquo;s pre-existing software, generic algorithmic libraries, developer daemons, and open-source packages utilized in the execution of the services. Contractor grants Client a perpetual, non-exclusive, royalty-free license to use any incorporated Background IP solely as part of the integrated deliverable.
              </p>
            </div>

            {/* Section 4: Confidentiality */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">4</span>
                Confidentiality &amp; Mutual Non-Disclosure (NDA)
              </h3>
              <p className="text-slate-300">
                Both Contractor and Client agree to protect and treat as confidential all non-public technical data, source code repositories, API credentials, customer information, and business strategy disclosed during the term of this Agreement. Confidential Information shall not be disclosed to third parties without prior written consent and shall be used exclusively for the performance of this Agreement.
              </p>
            </div>

            {/* Section 5: Warranties & Acceptance Period */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">5</span>
                Deliverable Acceptance Period &amp; 30-Day Defect Warranty
              </h3>
              <p className="text-slate-300">
                <strong className="text-slate-100">14-Day Acceptance Window:</strong> Upon delivery of each milestone, Client shall have fourteen (14) calendar days to inspect and test the deliverable against the agreed specifications. If Client does not provide written notice of material non-conformity within fourteen (14) days, the deliverable shall be deemed accepted and escrow released.
              </p>
              <p className="text-slate-300 text-xs">
                <strong className="text-slate-100">30-Day Critical Defect Warranty:</strong> Contractor warrants that for thirty (30) calendar days following final project acceptance, Contractor will promptly investigate and rectify any reproducible critical software defects or deviations from the written specifications without additional fee.
              </p>
            </div>

            {/* Section 6: Independent Contractor Relationship */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">6</span>
                Independent Contractor Relationship &amp; Tax Compliance
              </h3>
              <p className="text-slate-300">
                Contractor is engaged as an independent professional contractor. Nothing contained in this Agreement shall be construed to create a partnership, joint venture, employer-employee relationship, or agency between the parties. Contractor retains complete autonomy over working hours, physical location, and development methodology. Contractor is exclusively responsible for all tax liabilities, including Indian Goods &amp; Services Tax (GST 18% under SAC 998315) and income taxes.
              </p>
            </div>

            {/* Section 7: Term & Termination */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">7</span>
                Term, Termination &amp; Pro-Rata Settlement
              </h3>
              <p className="text-slate-300">
                This Agreement commences on the Effective Date and continues until completion of all milestones, unless terminated earlier by either party with seven (7) calendar days written notice. In the event of early termination, Client shall promptly compensate Contractor for all completed milestones and a pro-rata portion of any milestone work in progress prior to termination.
              </p>
            </div>

            {/* Section 8: Limitation of Liability */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-1.5 print:text-black">
                <span className="rounded bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 font-mono text-xs">8</span>
                Limitation of Liability &amp; Governing Law
              </h3>
              <p className="text-slate-300">
                To the maximum extent permitted by applicable law, neither party shall be liable for indirect, incidental, consequential, or punitive damages. The aggregate liability of Contractor arising out of or related to this Agreement shall not exceed the total fees paid to Contractor under this Agreement. This Agreement is governed by standard commercial contract law and the Indian Contract Act, 1872, with disputes resolved via expedited binding arbitration under UNCITRAL Commercial Rules.
              </p>
            </div>

          </div>

          {/* Execution & Digital Signature Block */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 space-y-4 print:border-black print:bg-white">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2 print:text-black">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                Article 9: Execution, Signatures &amp; Counterparts
              </h4>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                ELECTRONIC SIGNATURE VERIFIED
              </span>
            </div>

            <p className="text-xs text-slate-400">
              IN WITNESS WHEREOF, the parties hereto have caused this Independent Contractor Master Services Agreement to be executed by their duly authorized representatives as of the Effective Date.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Contractor Signature Box */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2 print:border-gray-300">
                <div className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                  Contractor Signature
                </div>
                <div className="font-serif italic text-xl text-emerald-400 py-1.5 border-b border-slate-800 print:text-black">
                  Kundan Kumar
                </div>
                <div className="text-[11px] text-slate-400 space-y-0.5">
                  <div>Name: <strong className="text-white print:text-black">Kundan Kumar</strong></div>
                  <div>Title: Principal Full-Stack Developer &amp; Autonomous Lead</div>
                  <div>Entity: Kundan Vision AI Technologies</div>
                  <div>Date: <span className="font-mono text-slate-300">{startedDate}</span></div>
                  <div className="text-[10px] font-mono text-emerald-400/90 pt-1">
                    SHA256: 7f8a91c0b34de88c21a4f0283e71d982b4
                  </div>
                </div>
              </div>

              {/* Client Signature Box */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2 print:border-gray-300">
                <div className="flex items-center justify-between text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                  <span>Client Authorized Signatory</span>
                  {isClientSigned && (
                    <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> COUNTERSIGNED
                    </span>
                  )}
                </div>

                <div className="font-serif italic text-xl text-indigo-300 py-1.5 border-b border-slate-800 print:text-black">
                  {clientSignerName}
                </div>

                <div className="text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span>Name:</span>
                    <input
                      type="text"
                      value={clientSignerName}
                      onChange={(e) => setClientSignerName(e.target.value)}
                      className="rounded bg-slate-950 px-2 py-0.5 text-xs text-white border border-slate-800 focus:border-emerald-500 focus:outline-none print:border-none print:bg-transparent"
                    />
                  </div>
                  <div>Title: Authorized Client Representative</div>
                  <div>Organization: <strong className="text-white print:text-black">{clientName}</strong></div>
                  <div>Date: <span className="font-mono text-slate-300">{signedTimestamp}</span></div>
                  <div className="text-[10px] font-mono text-indigo-400/90 pt-1">
                    STATUS: BINDING ELECTRONIC EXECUTION (eIDAS / IT ACT COMPLIANT)
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Action Button for Client Re-signing */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs border-t border-slate-800/80">
              <span className="text-slate-400 text-[11px] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Both parties maintain certified digital audit records of this execution.
              </span>
              <button
                type="button"
                onClick={handleSignAgreement}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Re-affirm &amp; Update Electronic Signature</span>
              </button>
            </div>
          </div>

        </div>

        {/* Modal Bottom Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/95 px-6 py-4 print:hidden">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Document Hash: SHA-256 Validated • Independent Contractor MSA</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all flex items-center gap-1.5"
            >
              <Printer className="h-4 w-4" />
              <span>Print Agreement</span>
            </button>

            <button
              onClick={onClose}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-5 py-2 text-xs font-bold text-white transition-all shadow-md active:scale-95 cursor-pointer"
            >
              Done &amp; Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

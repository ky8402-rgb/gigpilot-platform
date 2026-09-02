import { WorkOrder, Transaction, Invoice } from '../App';
import { ActiveContract, FreelancerProfile } from '../types';

export interface BackupDataPayload {
  workOrders: WorkOrder[];
  transactions: Transaction[];
  invoices?: Invoice[];
  contracts?: ActiveContract[];
  profile?: FreelancerProfile;
  stats?: {
    walletBalance?: number;
    todayEarnings?: number;
    completedOrders?: number;
  };
}

export interface BackupExportResult {
  success: boolean;
  filename: string;
  sizeBytes: number;
  exportedAt: string;
  totalWorkOrders: number;
  totalTransactions: number;
}

/**
 * Generates a formatted JSON string containing the state of Work Orders, Transactions, and metadata.
 */
export function generateBackupJson(data: BackupDataPayload): string {
  const timestamp = new Date().toISOString();
  
  const payload = {
    _schema: 'gigpilot-backup-v1',
    exportedAt: timestamp,
    version: '1.0.0',
    system: 'GigPilot Autonomous Freelance OS',
    summary: {
      totalWorkOrders: data.workOrders?.length || 0,
      totalTransactions: data.transactions?.length || 0,
      totalInvoices: data.invoices?.length || 0,
      totalContracts: data.contracts?.length || 0,
      stats: data.stats || {}
    },
    data: {
      workOrders: data.workOrders || [],
      transactions: data.transactions || [],
      invoices: data.invoices || [],
      contracts: data.contracts || [],
      profile: data.profile || null
    }
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Exports the current state of Work Orders and Transactions as a downloadable JSON file.
 * Creates an in-memory blob and triggers a browser download.
 */
export function exportStateAsBackup(
  data: BackupDataPayload,
  customFilename?: string
): BackupExportResult {
  try {
    const jsonString = generateBackupJson(data);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    const filename = customFilename || `gigpilot-backup-${dateStr}_${timeStr}.json`;

    // Create virtual download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    // Clean up
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 200);

    return {
      success: true,
      filename,
      sizeBytes: blob.size,
      exportedAt: now.toISOString(),
      totalWorkOrders: data.workOrders?.length || 0,
      totalTransactions: data.transactions?.length || 0
    };
  } catch (error) {
    console.error('[exportStateAsBackup] Failed to generate JSON backup:', error);
    throw error;
  }
}

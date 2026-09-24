export interface GSTCalculationResult {
  baseAmount: number; // in currency units (e.g. ₹850 or $10)
  taxRatePercent: number; // e.g. 18
  isInterState: boolean; // true = IGST, false = CGST + SGST
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  grandTotal: number;
  sacCode: string; // "998315"
  sacDescription: string;
  sellerGSTIN: string;
  sellerBusinessName: string;
  sellerAddress: string;
  sellerStateCode: string;
  sellerStateName: string;
  buyerGSTIN?: string;
  buyerStateCode?: string;
  buyerStateName?: string;
}

export const INDIAN_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

/**
 * Validates standard Indian GSTIN 15-character format
 * Pattern: 2 digits state code + 5 chars PAN + 4 digits PAN + 1 char entity + 1 char Z + 1 char checksum
 */
export function isValidGSTIN(gstin: string): boolean {
  if (!gstin) return false;
  const clean = gstin.trim().toUpperCase();
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(clean);
}

/**
 * Calculates complete Indian GST 18% tax breakdown for SaaS & AI proposal services
 */
export function calculateGST(
  baseAmount: number,
  buyerStateCode: string = '27',
  buyerGSTIN?: string
): GSTCalculationResult {
  const sellerStateCode = process.env.BUSINESS_STATE_CODE || '27';
  const sellerGSTIN = process.env.BUSINESS_GSTIN || '27AABCK3690F1Z9';
  const sellerBusinessName = process.env.BUSINESS_NAME || 'Kundan Vision AI Technologies Pvt Ltd';
  const sellerAddress = process.env.BUSINESS_ADDRESS || 'B-402, Cyber Heights Tech Park, Mumbai, Maharashtra 400051, India';
  const taxRate = Number(process.env.GST_RATE_PERCENT) || 18;

  // Derive buyer state code from GSTIN if provided
  let effectiveBuyerState = buyerStateCode;
  if (buyerGSTIN && isValidGSTIN(buyerGSTIN)) {
    effectiveBuyerState = buyerGSTIN.trim().substring(0, 2);
  }

  const isInterState = effectiveBuyerState !== sellerStateCode;
  const totalTaxAmount = Math.round((baseAmount * (taxRate / 100)) * 100) / 100;
  
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (isInterState) {
    igstAmount = totalTaxAmount;
  } else {
    cgstAmount = Math.round((totalTaxAmount / 2) * 100) / 100;
    sgstAmount = Math.round((totalTaxAmount / 2) * 100) / 100;
  }

  const grandTotal = Math.round((baseAmount + totalTaxAmount) * 100) / 100;

  return {
    baseAmount,
    taxRatePercent: taxRate,
    isInterState,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTaxAmount,
    grandTotal,
    sacCode: '998315',
    sacDescription: 'Hosting, Infrastructure Provisioning & Autonomous AI Software Services',
    sellerGSTIN,
    sellerBusinessName,
    sellerAddress,
    sellerStateCode,
    sellerStateName: INDIAN_STATES[sellerStateCode] || 'Maharashtra',
    buyerGSTIN: buyerGSTIN && isValidGSTIN(buyerGSTIN) ? buyerGSTIN.toUpperCase() : undefined,
    buyerStateCode: effectiveBuyerState,
    buyerStateName: INDIAN_STATES[effectiveBuyerState] || 'Other State / Union Territory'
  };
}

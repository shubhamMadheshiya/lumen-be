/**
 * Medical Report AI Parser Service
 * Uses Google Gemini (multimodal) to read lab tests, prescriptions, clinical notes, and imaging documents,
 * extracting title, date, doctor, clinic/lab, biomarkers, medications, and clinical observations.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../../config';

export interface ParsedBiomarker {
  name: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: 'normal' | 'high' | 'low' | 'critical';
}

export interface ParsedMedication {
  name: string;
  dosage?: string;
  frequency?: string;
  instructions?: string;
  refills?: number;
}

export interface ParsedMedicalReport {
  title: string;
  recordType: 'blood_test' | 'doctor_prescription' | 'imaging' | 'doctor_note';
  date: string;
  doctorName?: string;
  clinicOrLab?: string;
  notes?: string;
  biomarkers: ParsedBiomarker[];
  medications: ParsedMedication[];
}

export interface ParseReportInput {
  fileBase64?: string;
  mimeType?: string;
  fileText?: string;
}

const SYSTEM_PROMPT = `You are a clinical document analyst and medical laboratory AI for Lumen, a health tracking platform for autoimmune and chronic conditions.
Your task is to accurately read and parse medical reports, blood test results, doctor prescriptions, radiology/imaging reports, or clinical visit notes.

Extract the following structured information with clinical precision:
1. "title": A concise, accurate clinical title (e.g. "SwasthFit Super 4 Health Package", "Comprehensive Metabolic Panel (CMP)", "Lipid Panel", "Complete Blood Count (CBC)").
2. "recordType": Exactly one of "blood_test", "doctor_prescription", "imaging", "doctor_note". If any lab tests, blood tests, or biomarkers are present, ALWAYS choose "blood_test".
3. "date": The report or collection date in YYYY-MM-DD format. If only month/day/year is found, format as YYYY-MM-DD. If none found, use today's date.
4. "doctorName": Ordering doctor, referring physician ("Ref By"), or consulting pathologist (e.g. "Dr. Mattaparti Sridevi, MD"). If "Ref By" is "Self", look for the reporting pathologists/doctors.
5. "clinicOrLab": Name of the laboratory, diagnostic centre, clinic, or hospital from header/logo/footer (e.g. "Dr Lal PathLabs", "Quest Diagnostics", "Labcorp").
6. "notes": Comprehensive summary of clinical observations, doctor's impressions, diagnosis, abnormal findings, or recommendations.
7. "biomarkers": Array of all quantitative or qualitative lab tests / analytes present in the report. Each item must have:
   - "name": Standard analyte name (e.g. "Hemoglobin", "WBC", "Platelets", "TSH", "ALT", "AST", "CRP", "Ferritin", "Vitamin D, 25-Hydroxy")
   - "value": The numerical or categorical result (e.g. "14.2", "5.8", "Negative", "Reactive")
   - "unit": Measurement unit (e.g. "g/dL", "mg/dL", "uIU/mL", "%", "mmol/L")
   - "referenceRange": Standard normal reference interval as stated in the report (e.g. "12.0 - 16.0", "< 100", "0.5 - 4.5")
   - "flag": One of "normal", "high", "low", "critical" based on whether the value falls outside the reference range or has an indicator like (H), (L), (*), High, Low.
8. "medications": Array of all prescribed medications or treatments found. Each item must have:
   - "name": Drug or brand name (e.g. "Methotrexate", "Prednisone", "Levothyroxine", "Omeprazole")
   - "dosage": Strength / dose (e.g. "15mg", "50mcg", "10mg tablet")
   - "frequency": Administration schedule (e.g. "Once weekly", "Once daily in the morning", "Twice daily with meals")
   - "instructions": Clinical administration notes (e.g. "Take with food", "Do not take with antacids")
   - "refills": Number of refills authorized (if mentioned)

Respond ONLY with valid JSON conforming to this specification. Do not include markdown formatting or backticks outside the JSON.`;

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI | null {
  if (!config.gemini.apiKey) return null;
  if (!client) client = new GoogleGenerativeAI(config.gemini.apiKey);
  return client;
}

export async function parseMedicalReport(input: ParseReportInput): Promise<ParsedMedicalReport | null> {
  const genAI = getClient();
  if (!genAI) {
    throw new Error('Gemini API is not configured on the server. Please check GEMINI_API_KEY.');
  }

  const candidateModels = Array.from(
    new Set([
      config.gemini.model || 'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ])
  );

  const contents: any[] = [];

  if (input.fileBase64 && input.mimeType) {
    const cleanBase64 = input.fileBase64.replace(/^data:[^;]+;base64,/, '');
    contents.push({
      inlineData: {
        data: cleanBase64,
        mimeType: input.mimeType,
      },
    });
    contents.push('Please analyze this medical document and extract all fields according to the schema.');
  } else if (input.fileText) {
    contents.push(`Please analyze this medical document text and extract all fields according to the schema:\n\n${input.fileText}`);
  } else {
    throw new Error('No document content or file was provided for AI analysis.');
  }

  let text = '';
  let lastErr: any = null;

  for (const candidate of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: candidate,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 16384,
        },
      });
      const res = await model.generateContent(contents);
      text = res.response.text();
      if (text) break;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[reportParser] Model ${candidate} failed: ${err.message}. Trying next fallback...`);
    }
  }

  if (!text) {
    throw new Error(`AI report parsing failed: ${lastErr?.message || 'No response generated.'}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    // Attempt robust recovery for truncated JSON
    try {
      let repaired = text.trim();
      const quoteMatches = repaired.match(/"/g);
      if (quoteMatches && quoteMatches.length % 2 !== 0) {
        repaired += '"';
      }
      if (repaired.includes('"biomarkers"') && !repaired.includes(']')) {
        repaired += '}]';
      }
      if (!repaired.endsWith('}')) {
        repaired += '}';
      }
      parsed = JSON.parse(repaired);
    } catch (salvageErr) {
      console.error('[reportParser] JSON parse error from Gemini response:', text, err);
      throw new Error('Failed to parse AI response into structured medical data.');
    }
  }

  const biomarkersList = Array.isArray(parsed?.biomarkers)
    ? parsed.biomarkers
        .map((b: any) => ({
          name: String(b.name || '').trim(),
          value: String(b.value || '').trim(),
          unit: b.unit ? String(b.unit).trim() : undefined,
          referenceRange: b.referenceRange ? String(b.referenceRange).trim() : undefined,
          flag: ['normal', 'high', 'low', 'critical'].includes(b.flag as string) ? b.flag : 'normal',
        }))
        .filter((b: any) => b.name.length > 0)
    : [];

  const medicationsList = Array.isArray(parsed?.medications)
    ? parsed.medications
        .map((m: any) => ({
          name: String(m.name || '').trim(),
          dosage: m.dosage ? String(m.dosage).trim() : undefined,
          frequency: m.frequency ? String(m.frequency).trim() : undefined,
          instructions: m.instructions ? String(m.instructions) : undefined,
          refills: typeof m.refills === 'number' ? m.refills : undefined,
        }))
        .filter((m: any) => m.name.length > 0)
    : [];

  const determinedType =
    biomarkersList.length > 0
      ? 'blood_test'
      : ['blood_test', 'doctor_prescription', 'imaging', 'doctor_note'].includes(parsed?.recordType)
      ? parsed.recordType
      : medicationsList.length > 0
      ? 'doctor_prescription'
      : 'blood_test';

  return {
    title: parsed?.title || (biomarkersList.length > 0 ? 'Comprehensive Blood Test Panel' : 'Medical Health Record'),
    recordType: determinedType,
    date: parsed?.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      ? parsed.date
      : new Date().toISOString().split('T')[0],
    doctorName: parsed?.doctorName || undefined,
    clinicOrLab: parsed?.clinicOrLab || undefined,
    notes: parsed?.notes || undefined,
    biomarkers: biomarkersList,
    medications: medicationsList,
  };
}

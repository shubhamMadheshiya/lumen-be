const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { parseMedicalReport } = require('../dist/services/llm/reportParser');

const reportsDir = 'C:\\Users\\AIFA USER 276\\Downloads\\all-blood-report';
const files = [
  'Ana_autoimnobot_22-09-26.pdf',
  'Ana_screening_19-09-26.pdf',
  'Full-body-27-01-26.pdf',
  'Full-body-280926.pdf',
  'Full-body.pdf',
];

async function run() {
  console.log('Testing 5 blood reports from:', reportsDir);
  const results = {};

  for (const filename of files) {
    const filePath = path.join(reportsDir, filename);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      continue;
    }
    const stat = fs.statSync(filePath);
    console.log(`\n==================================================`);
    console.log(`Processing: ${filename} (${(stat.size / 1024).toFixed(1)} KB)`);
    console.log(`==================================================`);

    const fileBase64 = fs.readFileSync(filePath).toString('base64');
    const start = Date.now();
    try {
      const parsed = await parseMedicalReport({
        fileBase64,
        mimeType: 'application/pdf',
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`Done in ${elapsed}s!`);
      console.log(`Title: ${parsed.title}`);
      console.log(`Date: ${parsed.date}`);
      console.log(`Doctor: ${parsed.doctorName || 'N/A'}`);
      console.log(`Clinic/Lab: ${parsed.clinicOrLab || 'N/A'}`);
      console.log(`Biomarkers count: ${parsed.biomarkers.length}`);
      console.log(`Medications count: ${parsed.medications.length}`);
      if (parsed.notes) console.log(`Notes preview: ${parsed.notes.substring(0, 150)}...`);

      console.log(`\nSample biomarkers (first 5 of ${parsed.biomarkers.length}):`);
      parsed.biomarkers.slice(0, 5).forEach((b, idx) => {
        console.log(`  ${idx + 1}. [${b.flag.toUpperCase()}] ${b.name}: ${b.value} ${b.unit || ''} (ref: ${b.referenceRange || 'N/A'})`);
      });

      results[filename] = parsed;
    } catch (err) {
      console.error(`FAILED to parse ${filename}:`, err.message);
      results[filename] = { error: err.message };
    }
  }

  const outPath = path.join(__dirname, 'reports_parsed_summary.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved full parsed results to: ${outPath}`);
}

run();


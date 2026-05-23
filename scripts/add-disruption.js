'use strict';
// scripts/add-disruption.js
// CLI to insert a disruption event into the CADI system.
// Usage: node scripts/add-disruption.js content/inputs/disruption-event-YYYY-MM-DD.json

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Enums matching the database schema
const VALID_CATEGORIES = new Set(['policy', 'customs', 'infra', 'weather', 'capacity', 'other']);
const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function validateInput(data) {
  const errors = [];

  // Check required fields
  if (!data.event_date) {
    errors.push('Missing required field: event_date (format: YYYY-MM-DD)');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.event_date)) {
    errors.push('Invalid event_date format: must be YYYY-MM-DD');
  }

  if (!data.title_en) {
    errors.push('Missing required field: title_en');
  }

  if (!data.category) {
    errors.push('Missing required field: category');
  } else if (!VALID_CATEGORIES.has(data.category)) {
    errors.push(`Invalid category: "${data.category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }

  if (!data.severity) {
    errors.push('Missing required field: severity');
  } else if (!VALID_SEVERITIES.has(data.severity)) {
    errors.push(`Invalid severity: "${data.severity}". Must be one of: ${[...VALID_SEVERITIES].join(', ')}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

function buildRow(data) {
  // Map JSON fields to database columns
  const row = {
    event_date: data.event_date,
    title_en: data.title_en,
    title_ko: data.title_ko || null,
    title_ru: data.title_ru || null,
    title_zh: data.title_zh || null,
    category: data.category,
    event_type: data.event_type || null,
    region: data.region || null,
    severity: data.severity,
    started_at: data.started_at || data.event_date, // default to event_date if not provided
    resolved_at: data.resolved_at || null,
    lane_id: data.lane_id || null,
    affected_lanes: data.affected_lanes || [],
    body_en: data.body_en || null,
    impact_days: data.impact_days || null,
    source_url: data.source_url || null,
    verified_by: data.verified_by || [],
    description_en: data.description_en || data.title_en,
  };

  return row;
}

async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error('❌ Usage: node scripts/add-disruption.js <path-to-json-file>');
    process.exit(1);
  }

  const filePath = path.resolve(inputFile);

  // Read and parse JSON
  let data;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to read or parse file: ${filePath}`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // Strip instruction and comment keys
  delete data._instructions;
  delete data._comment;

  // Validate required fields
  const validation = validateInput(data);
  if (!validation.valid) {
    console.error('❌ Validation failed:');
    validation.errors.forEach(e => console.error(`   • ${e}`));
    process.exit(1);
  }

  // Build row for insertion
  const row = buildRow(data);

  // Insert into database
  const { data: insertedRow, error } = await supabase
    .from('disruption_events')
    .insert([row])
    .select('id');

  if (error) {
    console.error('❌ Database insert failed:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }

  if (!insertedRow || insertedRow.length === 0) {
    console.error('❌ Insert returned no rows');
    process.exit(1);
  }

  const eventId = insertedRow[0].id;
  console.log(`✅ Disruption event created: ${eventId}`);
  console.log(`   Date: ${data.event_date}`);
  console.log(`   Title: ${data.title_en}`);
  console.log(`   Severity: ${data.severity}`);
  console.log(`   Category: ${data.category}`);
}

main().catch(err => {
  console.error('❌ Unexpected error:');
  console.error(`   ${err.message}`);
  process.exit(1);
});

/**
 * Deprecated Business English Level 3 extension generator.
 *
 * Business English is now standardized to 5 lessons per chapter:
 * Listening, Reading, Speaking, Speaking, Review.
 *
 * This script used to generate Lessons 6 to 10 for Level 3 chapters.
 * That workflow is no longer valid and has been intentionally disabled.
 */

async function main() {
  throw new Error(
    'Deprecated script: Business English now uses only 5 lessons per chapter (Listening, Reading, Speaking, Speaking, Review).'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

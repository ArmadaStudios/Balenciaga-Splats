// Scans frames/ and writes frames-manifest.json listing the frame filenames
// that actually exist, in playback order. main.js plays back exactly this
// list, so gaps or a non-contiguous starting number (missing/deleted frames,
// on purpose or not) are simply skipped - no assumption that frame numbers
// form a contiguous 1..N range.
//
// Re-run this any time you add/remove/replace files in frames/:
//   node generate-frames-manifest.js

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const FRAMES_DIR = path.join(ROOT_DIR, 'frames');
const OUTPUT = path.join(ROOT_DIR, 'frames-manifest.json');

const FRAME_PATTERN = /^output_(\d+)\.(png|jpg|jpeg)$/i;

const files = fs.readdirSync(FRAMES_DIR)
  .filter((name) => FRAME_PATTERN.test(name))
  .sort((a, b) => {
    const na = parseInt(a.match(FRAME_PATTERN)[1], 10);
    const nb = parseInt(b.match(FRAME_PATTERN)[1], 10);
    return na - nb;
  });

if (files.length === 0) {
  throw new Error(`No output_###.(png|jpg) files found in ${FRAMES_DIR}`);
}

fs.writeFileSync(OUTPUT, JSON.stringify(files, null, 2));
console.log(`Wrote ${files.length} frame filenames to ${OUTPUT}`);
console.log(`First: ${files[0]}  Last: ${files[files.length - 1]}`);

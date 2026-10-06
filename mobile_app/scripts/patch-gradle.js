const fs = require('fs');
const path = require('path');

const ANDROID_DIR = path.resolve(__dirname, '../android');
const wrapperFile = path.join(ANDROID_DIR, 'gradle/wrapper/gradle-wrapper.properties');
const appGradleFile = path.join(ANDROID_DIR, 'app/build.gradle');

const APK_FILE_NAME = 'SAGE.apk';

// Sentinels so the injection can be replaced rather than skipped: the file is
// regenerated wholesale by `npx expo prebuild`, but when it survives (no
// prebuild, or a partial template update) a re-run must rewrite the block, not
// stack a second copy next to a stale one.
const BEGIN = '// [sage-patch] BEGIN apk output name';
const END = '// [sage-patch] END apk output name';

function patchGradleWrapper() {
  if (!fs.existsSync(wrapperFile)) {
    console.log('⚠️  gradle-wrapper.properties not found, skipping patch.');
    return;
  }

  const content = fs.readFileSync(wrapperFile, 'utf8');
  const patched = content.replace(
    /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-.*-bin\.zip/,
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip'
  );

  if (patched !== content) {
    fs.writeFileSync(wrapperFile, patched);
    console.log('✅ Patched gradle-wrapper.properties → gradle-8.13');
  } else {
    console.log('ℹ️  gradle-wrapper.properties already patched or pattern not found.');
  }
}

/**
 * Rename the built APK to SAGE.apk. Without this, AGP falls back to
 * `${moduleDirName}-${variantName}.apk` -- the Gradle module is `:app`, so every
 * build lands as app-release.apk / app-debug.apk.
 *
 * Notes on the API, since it is not obvious:
 *  - `output.outputFileName` (qualified!) must target the output object, not the
 *    variant. An unqualified `outputFileName = ...` resolves against the
 *    enclosing closure's owner and fails with
 *    "Could not set unknown property 'outputFileName' for object of type
 *     ApplicationVariantImpl".
 *  - `outputFileName` is absent from the public `BaseVariantOutput` interface in
 *    AGP 8.12 -- it survives only as a setter on `BaseVariantOutputImpl`, which
 *    Groovy reaches dynamically. If a future AGP drops it, this block fails
 *    loudly at configure time rather than silently emitting app-release.apk.
 *    The AGP 9 replacement is `androidComponents.onVariants { variant ->
 *    variant.outputs.forEach { it.outputFileName.set(...) } }`.
 *  - Debug and release build into separate output directories
 *    (outputs/apk/debug/ vs outputs/apk/release/), so one shared name is safe.
 */
function patchApkOutputName() {
  if (!fs.existsSync(appGradleFile)) {
    console.log('⚠️  android/app/build.gradle not found, skipping APK name patch.');
    return;
  }

  let content = fs.readFileSync(appGradleFile, 'utf8');

  if (content.includes(BEGIN) || content.includes(END)) {
    if (!content.includes(BEGIN) || !content.includes(END)) {
      console.error(
        '❌ Found only one of the [sage-patch] sentinels in app/build.gradle. ' +
          'Delete the leftover block by hand and re-run this script.'
      );
      process.exitCode = 1;
      return;
    }

    // Drop whole lines from BEGIN through END inclusive. Done line-wise on
    // purpose: a regex over the raw text can swallow the newline that follows
    // the block and weld it onto the preceding line.
    const lines = content.split('\n');
    const start = lines.findIndex((line) => line.includes(BEGIN));
    let end = -1;
    for (let i = start; i < lines.length; i += 1) {
      if (lines[i].includes(END)) {
        end = i;
        break;
      }
    }
    if (start === -1 || end === -1) {
      console.error('❌ Could not locate the [sage-patch] block boundaries. Re-check BEGIN/END.');
      process.exitCode = 1;
      return;
    }
    lines.splice(start, end - start + 1);
    // Drop the blank line(s) that separated the block from what follows, so
    // repeated runs converge instead of piling up another one each time.
    while (lines.length > start && lines[start].trim() === '') lines.splice(start, 1);
    content = lines.join('\n');
    console.log('ℹ️  Replaced the existing [sage-patch] APK name block.');
  }

  const anchor = 'android {';
  const occurrences = content.split('\n').filter((line) => line.trim() === anchor).length;
  if (occurrences !== 1) {
    // Failing loudly beats silently producing app-release.apk with no clue why.
    console.error(
      `❌ Expected exactly one top-level \`${anchor}\` block in app/build.gradle, found ${occurrences}. ` +
        'Re-anchor patchApkOutputName() in scripts/patch-gradle.js.'
    );
    process.exitCode = 1;
    return;
  }

  const indent = '    ';
  const block = [
    `${indent}${BEGIN}`,
    `${indent}// Injected by scripts/patch-gradle.js -- do not edit by hand:`,
    `${indent}// \`npx expo prebuild\` regenerates this whole file. Re-run that`,
    `${indent}// script instead. Debug and release land in separate output`,
    `${indent}// directories, so this one shared name is safe for both.`,
    `${indent}applicationVariants.all { variant ->`,
    `${indent}    variant.outputs.each { output ->`,
    `${indent}        output.outputFileName = "${APK_FILE_NAME}"`,
    `${indent}    }`,
    `${indent}}`,
    `${indent}${END}`,
  ].join('\n');

  // Trailing blank line mirrors the separator that strip() removes above, so
// insert-after-strip is an exact round trip.
fs.writeFileSync(appGradleFile, content.replace(anchor, `${anchor}\n${block}\n\n`));
  console.log(`✅ Patched app/build.gradle → ${APK_FILE_NAME}`);
}

patchGradleWrapper();
patchApkOutputName();